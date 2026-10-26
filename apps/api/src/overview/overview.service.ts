import {loadOrderSourceMap,countOrderSources} from '../orders/order-source';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseExchangeRateCache, type ExchangeRateCache } from '../finance/exchange-rates';
import { createReportConverter, financeBusinessDay, financePeriod, normalizeFinanceQuery } from '../finance/finance-report-model';
import { classifyOverviewOrder, eligibleUpcomingShipmentRecords, hasTrustedOverviewDeadline, loadOverviewOrderSources, OVERVIEW_BUCKETS, validateOverviewPeriod } from './overview-order-model';
import type { OverviewOrdersQueryDto } from './overview.dto';

/** Latest real message per exact conversation. Match Inbox visibility and actual sent/received chronology. */
export const overviewMessagesSql = Prisma.sql`
  SELECT recent.* FROM (
    SELECT DISTINCT ON (c."id") c."id" AS "conversationId",c."clientId",cl."displayName" AS "clientName",
      cl."avatarUrl",c."channel",c."unreadCount",m."content" AS "preview",
      (CASE WHEN m."direction"='OUTBOUND' THEN COALESCE(m."sentAt",m."createdAt") ELSE COALESCE(m."receivedAt",m."createdAt") END) AT TIME ZONE 'UTC' AS "at"
    FROM "Conversation" c JOIN "Client" cl ON cl."id"=c."clientId" JOIN "Message" m ON m."conversationId"=c."id"
    WHERE c."archivedAt" IS NULL AND cl."archivedAt" IS NULL AND cl."inboxSpamAt" IS NULL
      AND ((m."direction"='INBOUND' AND m."status"='RECEIVED') OR (m."direction"='OUTBOUND' AND m."status"='SENT'))
      AND m."messageType" <> 'reaction'
      AND m."metadata" #>> '{deletion,deletedAt}' IS NULL
      AND m."metadata" ->> 'deduplicatedIntoMessageId' IS NULL
    ORDER BY c."id", "at" DESC,m."id" DESC
  ) recent ORDER BY recent."at" DESC,recent."conversationId" ASC LIMIT 5
`;
type RecentConversation={conversationId:string;clientId:string;clientName:string;avatarUrl:string|null;channel:string;unreadCount:number;preview:string;at:Date};

@Injectable()
export class OverviewService {
  constructor(private readonly prisma:PrismaService) {}

  async orders(input:OverviewOrdersQueryDto={},now=new Date()) {
    const query=normalizeFinanceQuery(input,now),{month,start,end}=validateOverviewPeriod(query.month,now);
    const previousStart=financePeriod(month,-1),trendStart=financePeriod(month,1-query.range);
    return this.prisma.$transaction(async tx=>{
      const sources=await loadOverviewOrderSources(tx);
      const orderSources=await loadOrderSourceMap(tx,sources.map(order=>order.id));
      const breakdown=countOrderSources(sources,orderSources,start,end);
      const sourceAnalytics={total:breakdown.reduce((sum,row)=>sum+row.count,0),websiteCount:breakdown.find(row=>row.source==='WEBSITE')!.count,breakdown,trend:Array.from({length:query.range},(_,index)=>{const from=financePeriod(month,index-query.range+1),to=financePeriod(month,index-query.range+2);return {month:from.toISOString().slice(0,7),breakdown:countOrderSources(sources,orderSources,from,to)};})};
      const period=sources.filter(order=>order.createdAt>=start&&order.createdAt<end);
      const states=sources.map(order=>({order,state:classifyOverviewOrder(order,now)}));
      const ringStates=period.map(order=>classifyOverviewOrder(order,now));
      const segments=OVERVIEW_BUCKETS.map(key=>({key,count:ringStates.filter(state=>state.bucket===key).length}));
      const ringTotal=segments.reduce((total,segment)=>total+segment.count,0);
      const clientMonths=await tx.$queryRaw<{month:string;count:bigint}[]>(Prisma.sql`
        SELECT to_char(date_trunc('month',"createdAt"),'YYYY-MM') AS month,count(*) AS count
        FROM "Client" WHERE "archivedAt" IS NULL AND "createdAt">=${trendStart} AND "createdAt"<${end}
        GROUP BY 1 ORDER BY 1
      `);
      const recent=await tx.order.findMany({where:{archivedAt:null},take:5,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,number:true,priceMinor:true,currency:true,salesStatus:true,createdAt:true,sourceSystem:true,modelImagePath:true,externalImageUrl:true,client:{select:{displayName:true}},items:{where:{archivedAt:null,OR:[{modelImagePath:{not:null}},{externalImageUrl:{not:null}}]},orderBy:{id:'asc'},select:{modelImagePath:true,externalImageUrl:true}}}});
      const settings=await tx.appSetting.findMany({where:{section:'finance',key:{in:['exchangeRateProvider','exchangeRateCache']}},select:{key:true,value:true}});
      const provider=settings.find(setting=>setting.key==='exchangeRateProvider')?.value==='ECB'?'ECB':'NBU';
      let cache:ExchangeRateCache|null=null;
      try{cache=parseExchangeRateCache(settings.find(setting=>setting.key==='exchangeRateCache')?.value);}catch{/* Converter exposes unavailable rates only for needed conversions. */}
      const convert=createReportConverter(query.currency,{provider,cache:cache?.provider===provider?cache:null},now);
      let valuationError:string|null=null;
      const recentRows=recent.map(order=>{
        let amountMinor:number|null=null;
        try{amountMinor=convert(order.priceMinor,order.currency);}catch(error){valuationError=error instanceof Error?error.message:'Курс валют недоступен';}
        const orderSource=orderSources[order.id]??'UNKNOWN';
        const localImage=order.modelImagePath??order.items.find(item=>item.modelImagePath)?.modelImagePath??null;
        const websiteImage=order.sourceSystem==='YOLEOTARD_WEBSITE'?(order.externalImageUrl??order.items.find(item=>item.externalImageUrl)?.externalImageUrl??null):null;
        return {id:order.id,number:order.number,clientName:order.client.displayName,orderSource,modelImagePath:localImage??websiteImage,salesStatus:order.salesStatus,createdAt:order.createdAt.toISOString(),amountMinor,originalAmountMinor:order.priceMinor,originalCurrency:order.currency};
      });
      return {sourceAnalytics,month,currency:query.currency,today:financeBusinessDay(now),counts:{total:period.length,previousTotal:sources.filter(order=>order.createdAt>=previousStart&&order.createdAt<start).length,work:states.filter(row=>row.state.work).length,ready:states.filter(row=>row.state.ready).length,overdue:states.filter(row=>row.state.overdue).length,requiresVerification:states.filter(row=>row.state.requiresVerification).length,awaitingPayment:states.filter(row=>row.state.unpaid).length},ring:{total:ringTotal,excluded:period.length-ringTotal,segments},trend:Array.from({length:query.range},(_,index)=>{
        const from=financePeriod(month,index-query.range+1),to=financePeriod(month,index-query.range+2),key=from.toISOString().slice(0,7);
        return {month:key,orders:sources.filter(order=>order.createdAt>=from&&order.createdAt<to).length,clients:Number(clientMonths.find(row=>row.month===key)?.count??0)};
      }),recent:recentRows,valuationError};
    },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
  }

  async tasks(userId:string) {
    return this.prisma.$transaction(async tx=>{
      const [done,rows]=await Promise.all([
        tx.taskColumn.findFirst({where:{archivedAt:null,isDone:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],select:{id:true}}),
        tx.workTask.findMany({where:{archivedAt:null,assigneeId:userId,completedAt:null,column:{archivedAt:null,isDone:false}},take:5,orderBy:[{dueAt:{sort:'asc',nulls:'last'}},{id:'asc'}],select:{id:true,title:true,columnId:true,dueAt:true,client:{select:{displayName:true}}}}),
      ]);
      return {userId,doneColumnId:done?.id??null,rows:rows.map(row=>({id:row.id,title:row.title,columnId:row.columnId,dueAt:row.dueAt?.toISOString()??null,clientName:row.client?.displayName??null,orderId:null,orderNumber:null}))};
    },{isolationLevel:'RepeatableRead'});
  }

  async messages() {
    return this.prisma.$transaction(async tx=>{
      const [aggregate,rows]=await Promise.all([
        tx.conversation.aggregate({where:{archivedAt:null,client:{archivedAt:null,inboxSpamAt:null},unreadCount:{gt:0}},_sum:{unreadCount:true}}),
        tx.$queryRaw<RecentConversation[]>(overviewMessagesSql),
      ]);
      return {unreadCount:aggregate._sum.unreadCount??0,rows:rows.map(row=>({...row,at:row.at.toISOString(),preview:Array.from(row.preview).slice(0,240).join('')}))};
    },{isolationLevel:'RepeatableRead'});
  }

  async shipments(now=new Date()) {
    return this.prisma.$transaction(async tx=>{
      const sources=await loadOverviewOrderSources(tx),eligible=eligibleUpcomingShipmentRecords(sources,{},now);
      const rows=eligible.slice(0,5),ids=[...new Set(rows.map(row=>row.orderId))];
      const orders=ids.length?await tx.order.findMany({where:{id:{in:ids}},select:{id:true,number:true,client:{select:{displayName:true}}}}):[];
      const today=financeBusinessDay(now);
      const requiresVerification=sources.filter(order=>!hasTrustedOverviewDeadline(order)&&order.requiredDeliveryAt&&order.requiredDeliveryAt.toISOString().slice(0,10)>=today&&eligibleUpcomingShipmentRecords([{...order,sourceSystem:null}],{},now).length>0).length;
      return {today,count7:eligibleUpcomingShipmentRecords(sources,{horizon:7},now).length,requiresVerification,rows:rows.map(row=>({ ...row,number:orders.find(order=>order.id===row.orderId)!.number,clientName:orders.find(order=>order.id===row.orderId)!.client.displayName }))};
    },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
  }
}
