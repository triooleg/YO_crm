"use client";
import { Tooltip, UnstyledButton } from '@mantine/core';
import { useResizeObserver } from '@mantine/hooks';
import { overviewUi as ui } from '../lib/i18n';
import { moneyLabel, financeMonth } from '../lib/finance-report';
import { overviewTargets, type OverviewTarget } from '../lib/overview-navigation';
import type { OverviewBucket, OverviewOrders } from '../lib/overview-report';

const bucketColors:Record<OverviewBucket,string>={new:'#7944ff',work:'#1997ef',ready:'#ff9e22',awaiting:'#ff5964',completed:'#58c89f'};
type Go=(target:OverviewTarget)=>void;
function wholeCurrencyLabel(value:number,currency:string){
 const minor=BigInt(value),absolute=minor<0n?-minor:minor,rounded=(absolute+50n)/100n;
 return new Intl.NumberFormat('ru-RU',{style:'currency',currency,currencyDisplay:'narrowSymbol',minimumFractionDigits:0,maximumFractionDigits:0}).format(minor<0n?-rounded:rounded);
}
function compactCurrencyLabel(value:number,currency:string){
 const minor=BigInt(value),absolute=minor<0n?-minor:minor,rounded=(absolute+50n)/100n;
 const parts=new Intl.NumberFormat('ru-RU',{style:'currency',currency,currencyDisplay:'narrowSymbol',notation:'compact',minimumFractionDigits:0,maximumFractionDigits:0}).formatToParts(minor<0n?-rounded:rounded);
 return [parts.filter(part=>['integer','group','decimal','fraction','minusSign','plusSign'].includes(part.type)).map(part=>part.value).join(''),parts.filter(part=>part.type==='compact'||part.type==='currency').map(part=>part.value).join(' ')];
}
function activate(event:React.KeyboardEvent,action:()=>void){if(event.key==='Enter'||event.key===' '){event.preventDefault();action()}}
function displayShares(segments:OverviewOrders['ring']['segments'],total:number){
 if(!total)return segments.map(()=>0);
 const shares=segments.map((segment,index)=>{const exact=segment.count/total*100;return {index,whole:Math.floor(exact),remainder:exact-Math.floor(exact)}});
 let missing=100-shares.reduce((sum,share)=>sum+share.whole,0);
 for(const share of [...shares].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(missing--<=0)break;share.whole++}
 return shares.map(share=>share.whole);
}

export function OverviewStatusChart({ring,month,go,showNote=true}:{ring:OverviewOrders['ring'];month:string;go:Go;showNote?:boolean}){
 let offset=0;
 const percentages=displayShares(ring.segments,ring.total);
 return <><div className="overview-ring-content"><div className="overview-ring"><svg viewBox="0 0 220 220" role="group" aria-label={`${ui.statusChart}: ${ring.total}`}>
   {ring.total>0?ring.segments.map((segment,index)=>{
    const start=offset,share=segment.count/ring.total;offset+=share;
    const label=`${ui.buckets[segment.key]}: ${segment.count} (${percentages[index]}%)`,action=()=>go(overviewTargets.orders(segment.key,month));
    return share>0?<g key={segment.key} role="button" aria-label={label} tabIndex={0} onClick={action} onKeyDown={event=>activate(event,action)}><title>{label}</title><circle cx="110" cy="110" r="87" fill="none" stroke={bucketColors[segment.key]} strokeWidth="38" pathLength="100" strokeDasharray={`${share*100} ${100-share*100}`} strokeDashoffset={-start*100} transform="rotate(-90 110 110)"/></g>:null;
   }):<circle cx="110" cy="110" r="87" fill="none" stroke="#efebff" strokeWidth="38"/>}
   <text x="110" y="107" textAnchor="middle" className="overview-ring-total">{ring.total}</text><text x="110" y="128" textAnchor="middle" className="overview-ring-caption">{ui.ringTotal}</text>
  </svg></div><div className="overview-ring-legend">{ring.segments.map((segment,index)=><UnstyledButton key={segment.key} onClick={()=>go(overviewTargets.orders(segment.key,month))} aria-label={`${ui.buckets[segment.key]}: ${segment.count}`}><i style={{background:bucketColors[segment.key]}}/><span>{ui.buckets[segment.key]}</span><b>{segment.count}</b><small>{percentages[index]}%</small></UnstyledButton>)}</div></div>{showNote&&<OverviewStatusNote ring={ring}/>}</>;
}
export function OverviewStatusNote({ring}:{ring:OverviewOrders['ring']}){return ring.excluded>0?<Tooltip label={ui.excludedHint} multiline w={320}><p className="overview-note" tabIndex={0}>{ui.excluded}: {ring.excluded}</p></Tooltip>:null;}

export type OverviewBarSeries={key:string;label:string;color:string;values:{month:string;value:number}[];target:(month:string)=>OverviewTarget};
export function OverviewBarChart({series,currency,go,label,height:minimumHeight=190}:{series:OverviewBarSeries[];currency?:string;go:Go;label:string;height?:number}){
 const [ref,bounds]=useResizeObserver();
 const height=Math.max(minimumHeight,Math.round(bounds.height||minimumHeight));
 const width=Math.max(280,bounds.width||400),right=12,top=25,bottom=height-30;
 const months=series[0]?.values.map(row=>row.month)||[],values=series.flatMap(item=>item.values.map(row=>row.value));
 const rawMin=Math.min(0,...values),rawMax=Math.max(1,...values),roughStep=(rawMax-rawMin)*1.15/4,magnitude=10**Math.floor(Math.log10(roughStep));
 const axisStep=Math.max(1,([1,2,3,5,10].find(value=>value>=roughStep/magnitude)||10)*magnitude);
 const min=Math.max(-Number.MAX_SAFE_INTEGER,Math.floor(rawMin/axisStep)*axisStep),max=Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(rawMax*1.15/axisStep)*axisStep),span=max-min;
 const left=currency?Math.min(width*.32,Math.max(72,moneyLabel(Math.round(Math.max(Math.abs(min),Math.abs(max))),currency).length*6+12)):34;
 const y=(value:number)=>bottom-(value-min)/span*(bottom-top),zero=y(0),step=(width-left-right)/Math.max(months.length,1),barWidth=Math.min(28,step/(series.length+1.7));
 const monthLabel=(month:string)=>new Intl.DateTimeFormat('ru-RU',{month:'short',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
 const valueLabel=(value:number)=>currency?moneyLabel(value,currency):String(value);
 return <div className="overview-chart-plot" ref={ref}>{months.length?<svg className="overview-bar-chart" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
  {Array.from({length:Math.round(span/axisStep)+1},(_,tick)=>{const value=Math.round(min+axisStep*tick),position=y(value);return <g key={tick}><line x1={left} x2={width-right} y1={position} y2={position} stroke="#efedfa"/><text x={left-8} y={position+4} textAnchor="end" className="overview-axis">{currency?valueLabel(value).replace(',00',''):valueLabel(value)}</text></g>})}
  {months.map((month,index)=><g key={month}>
   {index%Math.max(1,Math.ceil(42/step))===0&&<text x={left+step*(index+.5)} y={height-7} textAnchor="middle" className="overview-axis">{monthLabel(month)}</text>}
   {series.map((item,seriesIndex)=>{
    const value=item.values.find(row=>row.month===month)?.value;
    if(value===undefined)return null;
    const x=left+step*(index+.5)+(seriesIndex-(series.length-1)/2)*(barWidth+3)-barWidth/2,position=y(value),barHeight=Math.abs(position-zero);
    const title=`${financeMonth(month)} · ${item.label}: ${valueLabel(value)}`,action=()=>go(item.target(month));
    const visibleLabel=currency?wholeCurrencyLabel(value,currency):valueLabel(value),labelFits=visibleLabel.length*6<step-4;
    const labelLines=!labelFits&&currency?compactCurrencyLabel(value,currency):[visibleLabel],twoLines=labelLines.length>1;
    const labelY=value>=0?position-(twoLines?21:8):Math.min(height-(twoLines?42:30),position+15);
    return <g key={item.key} role="button" tabIndex={0} aria-label={title} onClick={action} onKeyDown={event=>activate(event,action)}><title>{title}</title>
     <rect x={x-2} y={Math.min(position,zero)-3} width={barWidth+4} height={Math.max(barHeight+6,10)} fill="transparent"/>
     <rect x={x} y={Math.min(position,zero)} width={barWidth} height={barHeight} fill={item.color} rx="3"/>
     {months.length<=6&&(labelFits||Boolean(currency))&&(seriesIndex===0||series.length===1)&&<text x={x+barWidth/2} y={labelY} textAnchor="middle" className="overview-chart-value">{labelLines.map((line,lineIndex)=><tspan key={lineIndex} x={x+barWidth/2} dy={lineIndex?12:0}>{line}</tspan>)}</text>}
    </g>;
   })}
  </g>)}
 </svg>:<p className="overview-empty">{ui.emptyChart}</p>}</div>;
}

export function OverviewFinanceLegend({month,currency,go}:{month:string;currency:string;go:Go}){
 return <div className="overview-chart-legend">{[{key:'received',label:ui.received,color:'#7944ff',tab:'payments'},{key:'expenses',label:ui.expenses,color:'#ffa32b',tab:'expenses'}].map(item=><Tooltip key={item.key} label={item.label}><UnstyledButton onClick={()=>go(overviewTargets.finance(month,currency,item.tab,item.key))}><i style={{background:item.color}}/>{item.label}</UnstyledButton></Tooltip>)}</div>;
}
