import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import {ContactChannel, ClientStatus, Prisma} from '@prisma/client';
import {PrismaService} from '../prisma.service';
import {presentClientContact} from '../communications/inbound-routing';
import {clientHistoryOrderSelect, presentClientHistoryOrder, presentClientHistoryCurrencyTotals, summarizeClientOrderStatuses} from '../orders/order-client-history';
import {ExchangeRatesService, assertExchangeRateCacheFresh, buildRateForPair, type ExchangeRateCurrency} from '../finance/exchange-rates';
import {convertReportMinor} from '../finance/finance-report-model';

export type ClientsWorkspaceQuery = Record<string, unknown>;
const text = (value:unknown, max=200) => {
  if(value===undefined||value==='')return '';
  if(typeof value!=='string'||value.length>max||/[\p{Cc}]/u.test(value))throw new BadRequestException('Некорректный фильтр клиентов');
  return value.trim();
};
export function normalizeClientsWorkspaceQuery(query:ClientsWorkspaceQuery) {
  const integer=(value:unknown,fallback:number)=>{if(value===undefined||value==='')return fallback;if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new BadRequestException('Некорректная страница клиентов');return Number(value)};
  const page=integer(query.page,1),pageSize=integer(query.pageSize,20);
  if(page<1||page>100000||![15,20,50].includes(pageSize))throw new BadRequestException('Некорректная страница клиентов');
  const sort=text(query.sort)||'createdAt',direction=text(query.direction)||'desc',source=text(query.source),status=text(query.status),period=text(query.period);
  if(!['name','orderCount','latestOrder','createdAt'].includes(sort)||!['asc','desc'].includes(direction))throw new BadRequestException('Некорректная сортировка клиентов');
  if(source&&!Object.values(ContactChannel).includes(source as ContactChannel)||status&&!Object.values(ClientStatus).includes(status as ClientStatus))throw new BadRequestException('Некорректный фильтр клиентов');
  if(period&&!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(period))throw new BadRequestException('Некорректный месяц создания клиентов');
  return {page,pageSize,sort,direction,source,status,period,search:text(query.search),country:text(query.country,100)};
}

/** Read counterpart of durable inbound redirects; never guesses ownership by name. */
export async function canonicalWorkspaceClientId(db:Pick<Prisma.TransactionClient,'client'|'clientMergeRedirect'>,id:string) {
  if(!id||id.length>200||/[\s\p{Cc}]/u.test(id))throw new BadRequestException('Некорректный идентификатор клиента');
  const visited=new Set<string>();
  while(true){
    if(visited.has(id)||visited.size>=32)throw new BadRequestException('Некорректная цепочка объединения клиентов');
    visited.add(id);
    const redirect=await db.clientMergeRedirect.findUnique({where:{sourceClientId:id},select:{targetClientId:true}});
    if(!redirect)break;
    id=redirect.targetClientId;
  }
  if(!await db.client.findFirst({where:{id,archivedAt:null},select:{id:true}}))throw new NotFoundException('Клиент не найден');
  return id;
}

const contactSelect={id:true,displayName:true,avatarUrl:true,country:true,city:true,email:true,phone:true,instagram:true,instagramUsername:true,facebook:true,whatsapp:true,telegram:true,source:true,status:true,language:true,preferredChannel:true,createdAt:true,updatedAt:true} satisfies Prisma.ClientSelect;
const countedMinor=(value:number|null)=>{const n=value??0;if(!Number.isSafeInteger(n))throw new BadRequestException('Сумма вне допустимого диапазона');return n;};

/** Opt-in projection on Clients. Legacy list/detail are intentionally untouched. */
@Injectable()
export class ClientsWorkspaceReadService {
  constructor(private readonly prisma:PrismaService, private readonly rates?:ExchangeRatesService){}

  async list(query:ClientsWorkspaceQuery={}) {
    const q=normalizeClientsWorkspaceQuery(query);
    return this.prisma.$transaction(async db=>{
      const conditions=[Prisma.sql`c."archivedAt" IS NULL`];
      if(q.source)conditions.push(Prisma.sql`c.source::text=${q.source}`);
      if(q.status)conditions.push(Prisma.sql`c.status::text=${q.status}`);
      if(q.country)conditions.push(Prisma.sql`c.country=${q.country}`);
      if(q.period){const [year,month]=q.period.split('-').map(Number);conditions.push(Prisma.sql`c."createdAt">=${new Date(Date.UTC(year!,month!-1,1))} AND c."createdAt"<${new Date(Date.UTC(year!,month!,1))}`)}
      if(q.search){
        // Escape LIKE metacharacters: user input is a literal, never SQL syntax.
        const pattern='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%',digits=q.search.replace(/\D/g,'');
        conditions.push(Prisma.sql`(c."displayName" ILIKE ${pattern} OR c.email ILIKE ${pattern} OR c.phone ILIKE ${pattern} OR c.instagram ILIKE ${pattern} OR c."instagramUsername" ILIKE ${pattern} OR c.facebook ILIKE ${pattern} OR c.whatsapp ILIKE ${pattern} OR (${digits.length>=3} AND regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') LIKE ${'%'+digits+'%'}) OR EXISTS(SELECT 1 FROM "Conversation" v WHERE v."clientId"=c.id AND v."archivedAt" IS NULL AND v."externalId" ILIKE ${pattern}))`);
      }
      // Both identifiers and ordering fragments are a closed server-owned whitelist.
      const order={name:Prisma.sql`lower(c."displayName")`,orderCount:Prisma.sql`coalesce(o.n,0)`,latestOrder:Prisma.sql`o.latest`,createdAt:Prisma.sql`c."createdAt"`}[q.sort]!;
      const direction=q.direction==='asc'?Prisma.sql`ASC`:Prisma.sql`DESC`;
      const rows=await db.$queryRaw<{items:{id:string;orderCount:number;latestOrderAt:string|null;latestOrder:{id:string;number:string;createdAt:string}|null;channels:ContactChannel[]}[];total:number}[]>(Prisma.sql`
        WITH orders AS (SELECT "clientId",count(*)::int n,max("createdAt") latest FROM "Order" WHERE "archivedAt" IS NULL GROUP BY "clientId"),
        filtered AS (SELECT c.id,coalesce(o.n,0)::int AS "orderCount",o.latest AS "latestOrderAt",row_number() OVER(ORDER BY ${order} ${direction} NULLS LAST,c.id ASC) position FROM "Client" c LEFT JOIN orders o ON o."clientId"=c.id WHERE ${Prisma.join(conditions,' AND ')}),
        page AS (SELECT * FROM filtered ORDER BY position OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}),
        presented AS (SELECT page.*,(SELECT json_build_object('id',v.id,'number',v.number,'createdAt',v."createdAt" AT TIME ZONE 'UTC','sourceSystem',v."sourceSystem",'externalNumber',v."externalNumber",'externalId',v."externalId") FROM "Order" v WHERE v."clientId"=page.id AND v."archivedAt" IS NULL ORDER BY v."createdAt" DESC,v.id DESC LIMIT 1) AS "latestOrder",coalesce((SELECT json_agg(v.channel) FROM "Conversation" v WHERE v."clientId"=page.id AND v."archivedAt" IS NULL),'[]'::json) channels FROM page)
        SELECT coalesce((SELECT json_agg(presented ORDER BY position) FROM presented),'[]'::json) items,(SELECT count(*)::int FROM filtered) total`);
      const projection=rows[0]??{items:[],total:0},ids=projection.items.map(row=>row.id);
      const [clients,countries,sources,statuses]=await Promise.all([
        ids.length?db.client.findMany({where:{id:{in:ids},archivedAt:null},take:q.pageSize,select:contactSelect}):[],
        db.client.groupBy({by:['country'],where:{archivedAt:null,country:{not:null}}}),
        db.client.groupBy({by:['source'],where:{archivedAt:null}}),
        db.client.groupBy({by:['status'],where:{archivedAt:null}}),
      ]);
      const byId=new Map(clients.map(client=>[client.id,client]));
      return {items:projection.items.flatMap(row=>{const client=byId.get(row.id);return client?[{...presentClientContact(client),orderCount:row.orderCount,latestOrder:row.latestOrder??null,channels:row.channels??[]}]:[]}),total:projection.total,page:q.page,pageSize:q.pageSize,filters:{countries:countries.map(v=>v.country!).filter(value=>value.trim()).sort(),sources:sources.map(v=>v.source).sort(),statuses:statuses.map(v=>v.status).sort()}};
    },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
  }

  async detail(requestedId:string,query:ClientsWorkspaceQuery={}) {
    const tab=text(query.tab)||'overview';
    if(!['overview','conversations','files'].includes(tab))throw new BadRequestException('Некорректная вкладка клиента');
    const paging=normalizeClientsWorkspaceQuery({page:query.page,pageSize:query.pageSize});
    const reportCurrency=text(query.currency)||'EUR';
    if(!['EUR','USD','UAH'].includes(reportCurrency))throw new BadRequestException('Некорректная валюта отчёта');
    return this.prisma.$transaction(async db=>{
      const id=await canonicalWorkspaceClientId(db,requestedId);
      if(tab==='files'){
        const where={clientId:id},[total,items]=await Promise.all([db.clientFile.count({where}),db.clientFile.findMany({where,select:{id:true,name:true,path:true,mimeType:true,sizeBytes:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:paging.pageSize,skip:(paging.page-1)*paging.pageSize})]);
        return {clientId:id,items,total,page:paging.page,pageSize:paging.pageSize};
      }
      if(tab==='conversations'){
        const where={clientId:id,archivedAt:null};
        // Same visibility and original-timestamp policy as Inbox reply-state reads.
        const [total,items]=await Promise.all([db.conversation.count({where}),db.$queryRaw<{id:string;channel:ContactChannel;subject:string|null;lastMessageAt:Date|null;unreadCount:number;lastMessage:{content:string;createdAt:string}|null}[]>(Prisma.sql`
          WITH previews AS (SELECT DISTINCT ON(m."conversationId") m."conversationId",left(m.content,500) content,CASE WHEN m.direction='OUTBOUND' THEN coalesce(m."sentAt",m."createdAt") ELSE coalesce(m."receivedAt",m."createdAt") END AS "createdAt" FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE c."clientId"=${id} AND c."archivedAt" IS NULL AND ((m.direction='INBOUND' AND m.status='RECEIVED') OR (m.direction='OUTBOUND' AND m.status='SENT')) AND m."messageType"<>'reaction' AND m.metadata #>> '{deletion,deletedAt}' IS NULL AND m.metadata ->> 'deduplicatedIntoMessageId' IS NULL ORDER BY m."conversationId",CASE WHEN m.direction='OUTBOUND' THEN coalesce(m."sentAt",m."createdAt") ELSE coalesce(m."receivedAt",m."createdAt") END DESC,m.id DESC)
          SELECT c.id,c.channel,c.subject,c."unreadCount",p."createdAt" AS "lastMessageAt",CASE WHEN p."conversationId" IS NULL THEN NULL ELSE json_build_object('content',p.content,'createdAt',p."createdAt" AT TIME ZONE 'UTC') END AS "lastMessage" FROM "Conversation" c LEFT JOIN previews p ON p."conversationId"=c.id WHERE c."clientId"=${id} AND c."archivedAt" IS NULL ORDER BY p."createdAt" DESC NULLS LAST,c.id DESC LIMIT ${paging.pageSize} OFFSET ${(paging.page-1)*paging.pageSize}`)]);
        return {clientId:id,items,total,page:paging.page,pageSize:paging.pageSize};
      }
      const client=await db.client.findFirst({where:{id,archivedAt:null},select:{...contactSelect,notes:true,preferences:true,firstContactAt:true,lastContactAt:true,responsibleManagerId:true,responsibleManager:{select:{id:true,displayName:true}},athletes:{where:{archivedAt:null},orderBy:[{firstName:'asc'},{id:'asc'}],include:{measurements:{where:{archivedAt:null},orderBy:{measuredAt:'desc'},take:1}}},conversations:{where:{archivedAt:null},select:{id:true,channel:true,externalId:true}},activities:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,select:{id:true,type:true,summary:true,createdAt:true}}}});
      if(!client)throw new NotFoundException('Клиент не найден');
      const where={clientId:id,archivedAt:null};
      const [statuses,totals,payments,dates,recentOrders,managers]=await Promise.all([
        db.order.groupBy({by:['salesStatus'],where,_count:{_all:true}}),
        db.order.groupBy({by:['currency'],where,_sum:{priceMinor:true},orderBy:{currency:'asc'}}),
        db.payment.groupBy({by:['currency'],where:{voidedAt:null,order:where},_sum:{amountMinor:true},orderBy:{currency:'asc'}}),
        db.order.aggregate({where,_min:{createdAt:true},_max:{createdAt:true}}),
        db.order.findMany({where,select:clientHistoryOrderSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],take:5}),
        db.user.findMany({where:{active:true,archivedAt:null,role:{in:['OWNER','ADMIN','MANAGER']}},select:{id:true,displayName:true},orderBy:{displayName:'asc'},take:200}),
      ]);
      const contextOrder=query.orderId!==undefined?await db.order.findFirst({where:{id:text(query.orderId),...where},select:clientHistoryOrderSelect}):null;
      if(query.orderId!==undefined&&!contextOrder)throw new NotFoundException('Заказ не принадлежит выбранному клиенту');
      const orderIds=[...new Set([...recentOrders.map(order=>order.id),...(contextOrder?[contextOrder.id]:[])])];
      const itemGroups=orderIds.length?await db.orderItem.groupBy({by:['orderId'],where:{orderId:{in:orderIds},archivedAt:null,order:where},_count:{_all:true},_sum:{quantity:true}}):[];
      const aggregates=new Map(itemGroups.map(group=>[group.orderId,group]));
      const {conversations,...contact}=client;
      const totalsByCurrency=presentClientHistoryCurrencyTotals(totals).map(v=>({currency:v.currency,amountMinor:v.totalMinor})),paidByCurrency=payments.map(v=>({currency:v.currency,amountMinor:countedMinor(v._sum.amountMinor)}));
      // Reading a client never performs an external rate fetch or changes money.
      const cache=this.rates?(await this.rates.status()).cache:null;
      const totalInReportCurrency=(groups:{currency:string;amountMinor:number}[])=>{
        try {let amount=0;for(const group of groups){if(group.currency===reportCurrency)amount+=group.amountMinor;else {if(!cache) return null;assertExchangeRateCacheFresh(cache);amount+=convertReportMinor(group.amountMinor,buildRateForPair(cache,group.currency as ExchangeRateCurrency,reportCurrency as ExchangeRateCurrency))}if(!Number.isSafeInteger(amount))return null}return amount}catch{return null}
      };
      return {...presentClientContact(contact),canonicalClientId:id,channels:conversations,managers,summary:{...summarizeClientOrderStatuses(statuses),totalsByCurrency,paidByCurrency,reportCurrency,orderTotalMinor:totalInReportCurrency(totalsByCurrency),paidTotalMinor:totalInReportCurrency(paidByCurrency),rateDate:cache?.effectiveDate??null,firstOrderAt:dates._min.createdAt,lastOrderAt:dates._max.createdAt},orders:contextOrder?[presentClientHistoryOrder(contextOrder,aggregates.get(contextOrder.id))]:[],recentOrders:recentOrders.map(order=>presentClientHistoryOrder(order,aggregates.get(order.id)))};
    },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
  }

  async duplicates(query:ClientsWorkspaceQuery={}) {
    const q=normalizeClientsWorkspaceQuery(query),email=text(query.email).toLowerCase(),phone=text(query.phone).replace(/\D/g,''),name=text(query.name);
    const filter=Prisma.sql`c."archivedAt" IS NULL`;
    // Strong keys are normalized contacts or exact account-scoped conversation IDs.
    // Names are a weak manual-review signal only. No mutation happens here.
    const keys=Prisma.sql`SELECT id,'EMAIL' reason,lower(trim(email)) key FROM "Client" WHERE "archivedAt" IS NULL AND email IS NOT NULL AND trim(email)<>'' AND email !~ '^[0-9]+@facebook[.]com$'
      UNION ALL SELECT id,'PHONE',regexp_replace(phone,'[^0-9]','','g') FROM "Client" WHERE "archivedAt" IS NULL AND phone IS NOT NULL AND length(regexp_replace(phone,'[^0-9]','','g'))>=7
      UNION ALL SELECT v."clientId",'IDENTITY',v.channel::text||':'||v."externalId" FROM "Conversation" v JOIN "Client" c ON c.id=v."clientId" WHERE c."archivedAt" IS NULL AND v."externalId" IS NOT NULL AND v."externalId"<>''
      UNION ALL SELECT id,'NAME',lower(trim("displayName")) FROM "Client" WHERE "archivedAt" IS NULL AND trim("displayName")<>''`;
    type Related={id:string;reasons:string[]};
    const results=await this.prisma.$queryRaw<{items:{id:string;reasons:string[];related:Related[]}[];total:number}[]>(Prisma.sql`
      WITH keys AS (${keys}), duplicate_keys AS (SELECT reason,key FROM keys GROUP BY reason,key HAVING count(DISTINCT id)>1),
      matched AS (SELECT k.id,array_agg(DISTINCT k.reason) reasons FROM keys k JOIN duplicate_keys d USING(reason,key) GROUP BY k.id),
      candidates AS (SELECT c.id,coalesce(m.reasons,ARRAY[]::text[]) reasons FROM "Client" c LEFT JOIN matched m ON m.id=c.id WHERE ${filter} AND ${email||phone||name?Prisma.sql`(${Boolean(email)} AND lower(trim(c.email))=${email} OR ${Boolean(phone)} AND regexp_replace(c.phone,'[^0-9]','','g')=${phone} OR ${Boolean(name)} AND lower(trim(c."displayName"))=lower(${name}))`:Prisma.sql`m.id IS NOT NULL`} ${q.search?Prisma.sql`AND c."displayName" ILIKE ${'%'+q.search.replace(/[\\%_]/g,'\\$&')+'%'}`:Prisma.empty}),
      page AS (SELECT * FROM candidates ORDER BY id LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}),
      presented AS (SELECT page.*,coalesce((SELECT json_agg(related ORDER BY related.id) FROM (SELECT b.id,array_agg(DISTINCT a.reason) reasons FROM keys a JOIN keys b ON a.key=b.key AND a.reason=b.reason AND a.id<>b.id WHERE a.id=page.id GROUP BY b.id ORDER BY b.id LIMIT 21) related),'[]'::json) related FROM page)
      SELECT coalesce((SELECT json_agg(presented ORDER BY id) FROM presented),'[]'::json) items,(SELECT count(*)::int FROM candidates) total`);
    const projection=results[0]??{items:[],total:0},rows=projection.items;
    const clients=rows.length?await this.prisma.client.findMany({where:{id:{in:rows.map(row=>row.id)},archivedAt:null},select:contactSelect,take:q.pageSize}):[];
    const byId=new Map(clients.map(v=>[v.id,v]));
    return {items:rows.flatMap(row=>{
      const client=byId.get(row.id);if(!client)return [];
      const requestReasons=[...(email&&client.email?.trim().toLowerCase()===email?['EMAIL']:[]),...(phone&&client.phone?.replace(/\D/g,'')===phone?['PHONE']:[]),...(name&&client.displayName.trim().toLowerCase()===name.toLowerCase()?['NAME']:[])];
      const related=row.related.slice(0,20);
      return [{...presentClientContact(client),reasons:email||phone||name?requestReasons:row.reasons,requestReasons,related,duplicateIds:related.map(v=>v.id),relatedTruncated:row.related.length>20}];
    }),total:projection.total,page:q.page,pageSize:q.pageSize};
  }
}
