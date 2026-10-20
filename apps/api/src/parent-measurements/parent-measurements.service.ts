import { ParentMeasurementsRangesService, assertRangesAcknowledged } from './parent-measurements-ranges.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { createMeasurementData } from '../clients/measurement-data';
import { compositionToken } from '../orders/order-composition';
import { assertAssignmentMutable, assignmentOrderSelect } from '../orders/order-assignment-eligibility';
import { normalizeParentDraft, parentDefinitionVersion, parentLocales, publicChild } from './parent-measurements-data';
import { ParentMeasurementsAccessService, type ParentMeasurementsContext } from './parent-measurements-access.service';
import { mkdir,readFile,unlink,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { uploadsRoot } from '../uploads';

type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const revisionCheck=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw new BadRequestException('Некорректная версия черновика');return value as number;};
const keyCheck=(value:unknown)=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(value))throw new BadRequestException('Некорректный ключ операции');return value;};

@Injectable()
export class ParentMeasurementsService {
  constructor(private readonly prisma:PrismaService,private readonly access:ParentMeasurementsAccessService,private readonly ranges:ParentMeasurementsRangesService=new ParentMeasurementsRangesService(prisma)){}

  private async orderContext(tx:Tx,orderId:string){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"client-merge-global"},0))`;
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',orderId);
    const initial=await tx.order.findFirst({where:{id:orderId,archivedAt:null},select:{clientId:true}});
    if(!initial)throw new NotFoundException('Заказ недоступен');
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id"=${initial.clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${orderId} FOR UPDATE`;
    const order=await tx.order.findFirst({where:{id:orderId,clientId:initial.clientId,archivedAt:null,client:{archivedAt:null}},select:{id:true,number:true,...assignmentOrderSelect}});
    if(!order)throw new NotFoundException('Заказ недоступен');
    return order;
  }
  private async participantContext(tx:Tx,context:ParentMeasurementsContext){
    const order=await this.orderContext(tx,context.orderId);
    await this.access.assertContext(tx,context);
    await tx.$queryRaw`SELECT "id" FROM "MeasurementParticipant" WHERE "id"=${context.participantId} FOR UPDATE`;
    return order;
  }
  private async child(tx:Tx,context:ParentMeasurementsContext,id:string){
    const child=await tx.measurementParticipantChild.findFirst({where:{id,participantId:context.participantId,archivedAt:null},include:{submissions:{orderBy:{submittedAt:'desc'}}}});
    if(!child)throw new NotFoundException('Черновик недоступен');return child;
  }
  private async event(tx:Tx,context:{invitationId:string;participantId?:string;orderId:string;clientId:string},kind:string,submissionId?:string,actor?:User,metadata?:Prisma.InputJsonValue){
    await tx.measurementPublicEvent.create({data:{invitationId:context.invitationId,participantId:context.participantId,submissionId,actorType:actor?'STAFF':'PUBLIC_PARTICIPANT',staffActorId:actor?.id,kind,metadata}});
    const provenance={actorType:actor?'STAFF':'PUBLIC_PARTICIPANT',participantId:context.participantId,invitationId:context.invitationId,submissionId};
    await tx.auditLog.create({data:{actorId:actor?.id??null,action:kind,entityType:'MeasurementSubmission',entityId:submissionId,after:json(provenance)}});
    await tx.activity.create({data:{actorId:actor?.id??null,orderId:context.orderId,clientId:context.clientId,type:kind,summary:kind==='PARENT_MEASUREMENTS_RECEIVED'?'Получены измерения от родителя; требуется проверка':'Обновлена обработка измерений от родителя',metadata:json(provenance)}});
  }
  async createChild(context:ParentMeasurementsContext,firstName:unknown){
    const draft=normalizeParentDraft({firstName,values:{}});
    return this.prisma.$transaction(async tx=>{
      await this.participantContext(tx,context);
      if(await tx.measurementParticipantChild.count({where:{participantId:context.participantId,archivedAt:null}})>=10)throw new ConflictException('Достигнут лимит спортсменок');
      return publicChild(await tx.measurementParticipantChild.create({data:{participantId:context.participantId,draft:json(draft)}}));
    });
  }
  async saveDraft(context:ParentMeasurementsContext,id:string,revision:unknown,input:unknown){
    const expected=revisionCheck(revision),draft=normalizeParentDraft(input);
    return this.prisma.$transaction(async tx=>{
      await this.participantContext(tx,context);const child=await this.child(tx,context,id);
      if(child.revision!==expected)throw new ConflictException('Черновик изменён в другой вкладке');
      if(child.submissions.some(s=>s.revision===expected))throw new ConflictException('Отправленные мерки неизменяемы; создайте новую версию');
      const claim=await tx.measurementParticipantChild.updateMany({where:{id,participantId:context.participantId,revision:expected,archivedAt:null},data:{draft:json(draft),revision:{increment:1}}});
      if(claim.count!==1)throw new ConflictException('Черновик изменён в другой вкладке');
      if(draft.locale||draft.units)await tx.measurementParticipant.update({where:{id:context.participantId},data:{...(draft.locale?{locale:draft.locale}:{}),...(draft.units?{units:draft.units}:{})}});
      return publicChild(await tx.measurementParticipantChild.findUniqueOrThrow({where:{id}}));
    });
  }
  async revise(context:ParentMeasurementsContext,id:string){
    return this.prisma.$transaction(async tx=>{
      await this.participantContext(tx,context);const child=await this.child(tx,context,id);
      if(!child.submissions.some(s=>s.revision===child.revision))return publicChild(child);
      return publicChild(await tx.measurementParticipantChild.update({where:{id},data:{revision:{increment:1}}}));
    });
  }
  async archiveChild(context:ParentMeasurementsContext,id:string,revision:unknown){
    const expected=revisionCheck(revision);
    return this.prisma.$transaction(async tx=>{
      await this.participantContext(tx,context);const child=await this.child(tx,context,id);
      if(child.revision!==expected)throw new ConflictException('Черновик изменён в другой вкладке');
      await tx.measurementParticipantChild.update({where:{id},data:{archivedAt:new Date()}});
      return {ok:true};
    });
  }
  async uploadPhoto(context:ParentMeasurementsContext,id:string,mimeType:string,base64:string){
    if(typeof base64!=='string'||base64.length>2796204||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||!['image/jpeg','image/png','image/webp'].includes(mimeType))throw new BadRequestException('Выберите фотографию JPEG, PNG или WebP до 2 МБ');
    const source=Buffer.from(base64,'base64');if(!source.length||source.length>2097152)throw new BadRequestException('Фотография превышает 2 МБ');
    if(source.toString('base64')!==base64)throw new BadRequestException('Некорректная фотография');
    await this.prisma.$transaction(async tx=>{await this.participantContext(tx,context);await this.child(tx,context,id);});
    let bytes:Buffer;
    try{const image=sharp(source,{limitInputPixels:16_000_000,animated:false});const meta=await image.metadata();if(`image/${meta.format}`!==mimeType||(meta.pages??1)>1)throw new Error();bytes=await image.rotate().resize(320,320,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();}catch{throw new BadRequestException('Файл не является допустимой фотографией');}
    const storageKey=randomUUID()+'.jpg',dir=join(uploadsRoot(),'private-parent-measurements');
    await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,storageKey),bytes,{flag:'wx',mode:0o600});
    try{return await this.prisma.$transaction(async tx=>{
      await this.participantContext(tx,context);await this.child(tx,context,id);
      if(await tx.measurementDraftAsset.count({where:{participantId:context.participantId}})>=30)throw new ConflictException('Достигнут лимит фотографий; обратитесь к менеджеру');
      await tx.measurementDraftAsset.updateMany({where:{childId:id,participantId:context.participantId,archivedAt:null},data:{archivedAt:new Date()}});
      await tx.measurementDraftAsset.create({data:{childId:id,participantId:context.participantId,storageKey,mimeType:'image/jpeg',sizeBytes:bytes.length}});
      return {url:`/api/public/parent-measurements/photos/${id}`};
    });}catch(error){await unlink(join(dir,storageKey)).catch(()=>{});throw error;}
  }
  async photo(context:ParentMeasurementsContext,id:string){
    const asset=await this.prisma.$transaction(async tx=>{await this.participantContext(tx,context);await this.child(tx,context,id);return tx.measurementDraftAsset.findFirst({where:{childId:id,participantId:context.participantId,archivedAt:null},orderBy:{createdAt:'desc'}});});
    if(!asset||!/^[a-f0-9-]+\.jpg$/.test(asset.storageKey))throw new NotFoundException('Фотография недоступна');
    return readFile(join(uploadsRoot(),'private-parent-measurements',asset.storageKey));
  }
  private receipt(s:{id:string;measurementId:string;reviewStatus:string}){return {id:s.id,measurementId:s.measurementId,reviewStatus:s.reviewStatus,assignmentStatus:'UNASSIGNED'};}
  async submit(context:ParentMeasurementsContext,id:string,input:{revision:unknown;operationKey:unknown;consent:unknown}){
    const expected=revisionCheck(input.revision),operationKey=keyCheck(input.operationKey);
    if(input.consent!==true)throw new BadRequestException('Подтвердите отправку измерений');
    const requestHash=compositionToken({childId:id,revision:expected,consent:true});
    return this.prisma.$transaction(async tx=>{
      const order=await this.participantContext(tx,context);
      const previous=await tx.measurementSubmission.findUnique({where:{participantId_operationKey:{participantId:context.participantId,operationKey}}});
      if(previous){if(previous.requestHash!==requestHash)throw new ConflictException('Ключ уже использован для другого запроса');return this.receipt(previous);}
      const child=await this.child(tx,context,id);
      const accepted=child.submissions.find(s=>s.revision===expected);
      if(accepted)return this.receipt(accepted);
      if(child.revision!==expected)throw new ConflictException('Проверьте актуальную версию черновика');
      const draft=normalizeParentDraft(child.draft,true);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pm-ranges'},0))`;
      const evaluatedWarnings=assertRangesAcknowledged(await this.ranges.policy(tx),draft);
      let athlete=child.athleteId?await tx.athlete.findFirst({where:{id:child.athleteId,clientId:order.clientId,archivedAt:null}}):null;
      if(child.athleteId&&!athlete)throw new ConflictException('Профиль спортсменки требует проверки менеджером');
      if(!athlete)athlete=await tx.athlete.create({data:{clientId:order.clientId,firstName:draft.firstName,lastName:draft.lastName,discipline:draft.discipline}});
      const fields={...draft.values,measuredAt:`${draft.measuredAt}T00:00:00.000Z`,notes:draft.notes} as Parameters<typeof createMeasurementData>[1];
      const measurement=await tx.measurement.create({data:{...createMeasurementData(athlete.id,fields,parentDefinitionVersion),height:draft.heightCm,source:'PARENT_FORM'}});
      const photo=await tx.measurementDraftAsset.findFirst({where:{childId:id,participantId:context.participantId,archivedAt:null},orderBy:{createdAt:'desc'},select:{id:true}});
      const submission=await tx.measurementSubmission.create({data:{childId:id,participantId:context.participantId,revision:expected,operationKey,requestHash,measurementId:measurement.id,athleteId:athlete.id,previousSubmissionId:child.submissions[0]?.id,payload:json({...draft,evaluatedWarnings,definitionVersion:parentDefinitionVersion,consentVersion:'parent-measurements-v1',...(photo?{photoAssetId:photo.id}:{})})}});
      await tx.measurementParticipantChild.update({where:{id},data:{athleteId:athlete.id}});
      await this.event(tx,{...context,clientId:order.clientId},'PARENT_MEASUREMENTS_RECEIVED',submission.id);
      return this.receipt(submission);
    },{maxWait:10000,timeout:30000});
  }

  async dashboard(orderId:string){
    return this.prisma.$transaction(async tx=>{
      await this.orderContext(tx,orderId);
      const invitations=await tx.measurementInvitation.findMany({where:{orderId},select:{id:true,mode:true,locale:true,expiresAt:true,revokedAt:true,admittedCount:true},orderBy:{createdAt:'desc'},take:100});
      const submissions=await tx.measurementSubmission.findMany({where:{child:{participant:{invitation:{orderId}}}},include:{measurement:true,child:{select:{participant:{select:{invitation:{select:{mode:true}}}}}}},orderBy:{submittedAt:'desc'},take:100});
      const rows=[];
      for(const s of submissions){
        const p=s.payload as Record<string,unknown>;
        const mode=s.child.participant.invitation.mode;
        // Capture preferences belong to the accepted payload, never the current draft/session.
        const provenance={submittedAt:s.submittedAt,invitationMode:mode==='SHARED'||mode==='PERSONAL'?mode:null,
          locale:parentLocales.find(locale=>locale===p.locale)??null,units:p.units==='cm'||p.units==='in'?p.units:null,
          ageYears:typeof p.age==='number'&&Number.isInteger(p.age)&&p.age>=0&&p.age<=120?p.age:null,source:'PARENT' as const};
        const linked=await tx.orderItemInstance.count({where:{measurementId:s.measurementId,archivedAt:null,orderItem:{orderId,archivedAt:null}}});
        rows.push({id:s.id,childName:p.firstName,athleteId:s.athleteId,measuredAt:s.measurement.measuredAt,measurementId:s.measurementId,definitionVersion:s.measurement.definitionVersion,hasPhoto:typeof p.photoAssetId==='string',reviewStatus:s.reviewStatus,assignmentStatus:linked?'ASSIGNED':'UNASSIGNED',discipline:p.discipline,values:s.measurement.values,notes:s.measurement.notes,warnings:Array.isArray(p.evaluatedWarnings)?p.evaluatedWarnings.map((w:any)=>`№${w.field}: ${w.valueCm} см (${w.lowerCm}–${w.upperCm} см), подтверждено родителем`):[],updatedAt:s.updatedAt,provenance});
      }
      const expectedPieces=await tx.orderItemInstance.count({where:{archivedAt:null,orderItem:{orderId,archivedAt:null}}});
      const drafts=await tx.measurementParticipantChild.findMany({where:{participant:{invitation:{orderId}},archivedAt:null},select:{id:true,revision:true,draft:true,athleteId:true},take:100});
      const athletes=await tx.athlete.findMany({where:{clientId:(await tx.order.findUniqueOrThrow({where:{id:orderId},select:{clientId:true}})).clientId,archivedAt:null},select:{id:true,firstName:true,lastName:true},take:1000});
      const manualEvents=await tx.activity.findMany({where:{orderId,type:{in:['ATHLETE_CREATED','MEASUREMENT_CREATED']}},select:{metadata:true}});
      const activeAthleteIds=new Set(athletes.map(athlete=>athlete.id));
      const manualAthleteIds=[...new Set(manualEvents.flatMap(({metadata})=>{
        const id=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?metadata.athleteId:undefined;
        return typeof id==='string'&&activeAthleteIds.has(id)?[id]:[];
      }))];
      return {invitations,submissions:rows,expectedPieces,drafts:drafts.map(c=>({id:c.id,revision:c.revision,firstName:(c.draft as {firstName?:string}).firstName,athleteId:c.athleteId})),athletes,manualAthleteIds};
    });
  }
  async staffPhoto(orderId:string,id:string){
    const asset=await this.prisma.$transaction(async tx=>{
      await this.orderContext(tx,orderId);const s=await this.submission(tx,orderId,id);
      const photoAssetId=(s.payload as {photoAssetId?:unknown}).photoAssetId;
      if(typeof photoAssetId!=='string')throw new NotFoundException('Фотография недоступна');
      return tx.measurementDraftAsset.findFirst({where:{id:photoAssetId,childId:s.childId}});
    });
    if(!asset||!/^[a-f0-9-]+\.jpg$/.test(asset.storageKey))throw new NotFoundException('Фотография недоступна');
    return readFile(join(uploadsRoot(),'private-parent-measurements',asset.storageKey));
  }
  private async submission(tx:Tx,orderId:string,id:string){
    const s=await tx.measurementSubmission.findFirst({where:{id,child:{participant:{invitation:{orderId}}}},include:{child:{include:{participant:true}},measurement:true}});
    if(!s)throw new NotFoundException('Полученные мерки не найдены');return s;
  }
  async review(orderId:string,id:string,input:{expectedUpdatedAt:string;status:string;reason?:string},actor:User){
    if(!['VERIFIED','NEEDS_CLARIFICATION'].includes(input.status)||!Number.isFinite(Date.parse(input.expectedUpdatedAt))||(input.reason?.length??0)>2000)throw new BadRequestException('Проверьте решение менеджера');
    return this.prisma.$transaction(async tx=>{
      const order=await this.orderContext(tx,orderId),s=await this.submission(tx,orderId,id);
      const requestHash=compositionToken({kind:'PARENT_REVIEW',id,input,actorId:actor.id}),operationKey=`pmreview_${requestHash}`;
      const previous=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey}}});
      if(previous)return previous.result;
      if(s.updatedAt.toISOString()!==new Date(input.expectedUpdatedAt).toISOString())throw new ConflictException('Проверка уже изменена другим сотрудником');
      const updated=await tx.measurementSubmission.update({where:{id},data:{reviewStatus:input.status}});
      await this.event(tx,{invitationId:s.child.participant.invitationId,participantId:s.participantId,orderId,clientId:order.clientId},'PARENT_MEASUREMENTS_REVIEWED',id,actor,json({status:input.status,reason:input.reason}));
      const result=json({id:updated.id,reviewStatus:updated.reviewStatus,updatedAt:updated.updatedAt});
      await tx.orderCompositionOperation.create({data:{orderId,actorId:actor.id,operationKey,requestHash,result}});
      return result;
    });
  }
  async assign(orderId:string,id:string,input:{targets:Array<{id:string;expectedUpdatedAt:string}>;operationKey:string;confirmProduction?:boolean;reason?:string},actor:User){
    keyCheck(input.operationKey);
    if(!Array.isArray(input.targets)||!input.targets.length||input.targets.length>1000||new Set(input.targets.map(t=>t.id)).size!==input.targets.length||(input.reason?.length??0)>2000)throw new BadRequestException('Выберите разные экземпляры');
    return this.prisma.$transaction(async tx=>{
      const order=await this.orderContext(tx,orderId),s=await this.submission(tx,orderId,id);
      const requestHash=compositionToken({kind:'PARENT_ASSIGN',submissionId:id,actorId:actor.id,...input});
      const prior=await tx.orderCompositionOperation.findUnique({where:{orderId_operationKey:{orderId,operationKey:input.operationKey}}});
      if(prior){if(prior.requestHash!==requestHash)throw new ConflictException('Ключ уже использован');return prior.result;}
      if(s.measurement.archivedAt||!await tx.athlete.findFirst({where:{id:s.athleteId,clientId:order.clientId,archivedAt:null}}))throw new ConflictException('Профиль или версия мерок недоступны');
      const instances=[];
      for(const target of [...input.targets].sort((a,b)=>a.id.localeCompare(b.id))){
        const current=await tx.orderItemInstance.findFirst({where:{id:target.id,archivedAt:null,orderItem:{orderId,archivedAt:null}},include:{orderShipment:true}});
        if(!current||!Number.isFinite(Date.parse(target.expectedUpdatedAt))||current.updatedAt.toISOString()!==new Date(target.expectedUpdatedAt).toISOString())throw new ConflictException('Экземпляр изменён; обновите заказ');
        assertAssignmentMutable(order,current);
        if((current.startedAt||!['NOT_SCHEDULED','TENTATIVE','SCHEDULED'].includes(current.productionStatus))&&(!input.confirmProduction||!input.reason?.trim()))throw new ConflictException('Подтвердите изменение мерок начатого производства и укажите причину');
        const claim=await tx.orderItemInstance.updateMany({where:{id:current.id,updatedAt:current.updatedAt,archivedAt:null},data:{athleteId:s.athleteId,measurementId:s.measurementId}});
        if(claim.count!==1)throw new ConflictException('Экземпляр изменён; обновите заказ');
        const updated=await tx.orderItemInstance.findUniqueOrThrow({where:{id:current.id}});
        await tx.measurementSubmissionTarget.create({data:{submissionId:id,instanceId:current.id,staffActorId:actor.id,beforeMeasurementId:current.measurementId,afterMeasurementId:s.measurementId}});
        await tx.auditLog.create({data:{actorId:actor.id,action:'UPDATE',entityType:'OrderItemInstance',entityId:current.id,before:json({athleteId:current.athleteId,measurementId:current.measurementId}),after:json({athleteId:s.athleteId,measurementId:s.measurementId,reason:input.reason,confirmProduction:input.confirmProduction})}});
        instances.push(updated);
      }
      await this.event(tx,{invitationId:s.child.participant.invitationId,participantId:s.participantId,orderId,clientId:order.clientId},'PARENT_MEASUREMENTS_ASSIGNED',id,actor);
      const result=json({instances});
      await tx.orderCompositionOperation.create({data:{orderId,operationKey:input.operationKey,actorId:actor.id,requestHash,result}});
      return result;
    },{maxWait:10000,timeout:60000});
  }
  async bindAthlete(orderId:string,childId:string,input:{athleteId:string;expectedRevision:number;representativeVerified:boolean;reason:string},actor:User){
    if(input.representativeVerified!==true||!input.reason?.trim())throw new BadRequestException('Подтвердите проверку представительства');
    return this.prisma.$transaction(async tx=>{
      const order=await this.orderContext(tx,orderId);
      const child=await tx.measurementParticipantChild.findFirst({where:{id:childId,archivedAt:null,participant:{invitation:{orderId}}},include:{participant:true,submissions:true}});
      if(!child||child.revision!==input.expectedRevision||child.submissions.length)throw new ConflictException('Привязка возможна до первой отправки; обновите заказ');
      if(!await tx.athlete.findFirst({where:{id:input.athleteId,clientId:order.clientId,archivedAt:null}}))throw new NotFoundException('Спортсменка клиента не найдена');
      await tx.measurementParticipantChild.update({where:{id:childId},data:{athleteId:input.athleteId,revision:{increment:1}}});
      await this.event(tx,{invitationId:child.participant.invitationId,participantId:child.participantId,orderId,clientId:order.clientId},'PARENT_REPRESENTATIVE_VERIFIED',undefined,actor,json({athleteId:input.athleteId,reason:input.reason,childId}));
      return {ok:true};
    });
  }
}
