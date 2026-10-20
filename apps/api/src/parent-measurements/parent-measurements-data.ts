import { BadRequestException } from '@nestjs/common';
import { Discipline } from '@prisma/client';

export const parentDefinitionVersion = 'PARENT_BODY_V1';
export const parentLocales = ['ru','en','fr','de','es','it'] as const;
export type ParentDraft = {
  firstName:string; lastName?:string; age?:number; heightCm?:number;
  discipline?:Discipline; measuredAt?:string; values:Record<string,number>;
  notes?:string; warningsAcknowledged?:string[]; locale?:string; units?:'cm'|'in'; rangeVersion?:string;
};
const allowed = new Set(['firstName','lastName','age','heightCm','discipline','measuredAt','values','notes','warningsAcknowledged','locale','units','rangeVersion']);
const invalid = () => new BadRequestException('Проверьте поля измерений');
function text(value:unknown,max:number,required=false):string|undefined {
  if(value===undefined&&!required)return undefined;
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw invalid();
  const result=value.trim();if(required&&!result)throw invalid();return result||undefined;
}
export function normalizeParentDraft(input:unknown,complete=false):ParentDraft {
  if(!input||typeof input!=='object'||Array.isArray(input))throw invalid();
  const data=input as Record<string,unknown>;
  if(Object.keys(data).some(key=>!allowed.has(key)))throw invalid();
  const firstName=text(data.firstName,100,true)!;
  const lastName=text(data.lastName,100),notes=text(data.notes,2000);
  const values:Record<string,number>={};
  const source=data.values??{};
  if(typeof source!=='object'||source===null||Array.isArray(source))throw invalid();
  for(const [key,value] of Object.entries(source)){
    if(!/^m([1-9]|1[0-7])$/.test(key)||typeof value!=='number'||!Number.isFinite(value)||value<1||value>9999.5||!Number.isInteger(value*2))throw invalid();
    values[key]=value;
  }
  if(complete&&[1,2,3,15].some(number=>values[`m${number}`]===undefined))throw new BadRequestException('Заполните измерения №1, №2, №3 и №15');
  const discipline=data.discipline;
  if(discipline!==undefined&&(typeof discipline!=='string'||!Object.values(Discipline).includes(discipline as Discipline)))throw invalid();
  if(complete&&!discipline)throw new BadRequestException('Выберите вид спорта');
  const measuredAt=text(data.measuredAt,10);
  if(measuredAt){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt))throw invalid();
    const date=new Date(`${measuredAt}T00:00:00.000Z`);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==measuredAt||measuredAt>today)throw invalid();
  }else if(complete)throw new BadRequestException('Укажите дату измерения');
  const heightCm=data.heightCm,age=data.age;
  if(heightCm!==undefined&&(typeof heightCm!=='number'||!Number.isFinite(heightCm)||heightCm<1||heightCm>9999.5||!Number.isInteger(heightCm*2)))throw invalid();
  if(age!==undefined&&(typeof age!=='number'||!Number.isInteger(age)||age<0||age>120))throw invalid();
  if(data.locale!==undefined&&!parentLocales.includes(data.locale as typeof parentLocales[number]))throw invalid();
  if(data.units!==undefined&&!['cm','in'].includes(data.units as string))throw invalid();
  const rangeVersion=text(data.rangeVersion,36);
  if(rangeVersion&&!/^[a-f0-9-]{36}$/i.test(rangeVersion))throw invalid();
  const warnings=data.warningsAcknowledged;
  if(warnings!==undefined&&(!Array.isArray(warnings)||warnings.length>17||warnings.some(w=>typeof w!=='string'||w.length>80||!/^[a-zA-Z0-9:_-]+$/.test(w))))throw invalid();
  return {firstName,...(lastName?{lastName}:{}),...(notes?{notes}:{}),values,
    ...(discipline?{discipline:discipline as Discipline}:{}),...(measuredAt?{measuredAt}:{}),
    ...(heightCm!==undefined?{heightCm:heightCm as number}:{}),...(age!==undefined?{age:age as number}:{}),
    ...(data.locale?{locale:data.locale as string}:{}),...(data.units?{units:data.units as 'cm'|'in'}:{}),
    ...(rangeVersion?{rangeVersion}:{}),
    ...(warnings?{warningsAcknowledged:[...new Set(warnings as string[])]}:{}),};
}

export function publicChild(child:{id:string;revision:number;draft:unknown;submissions?:Array<{id:string;measurementId:string;reviewStatus:string;revision:number}>}){
  const submitted=child.submissions?.find(s=>s.revision===child.revision);
  return {id:child.id,revision:child.revision,draft:child.draft,...(submitted?{submitted:{id:submitted.id,measurementId:submitted.measurementId,reviewStatus:submitted.reviewStatus}}:{})};
}
