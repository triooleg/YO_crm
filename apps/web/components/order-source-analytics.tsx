"use client";
import { useResizeObserver } from "@mantine/hooks";
import { Badge, Select, SegmentedControl, UnstyledButton } from '@mantine/core';
import { orderSourceUi as ui } from '../lib/i18n';
import { financeMonth, moneyLabel } from '../lib/finance-report';
import { sourceColors, sourceLabel, sourceOptions, sourcePercentages, type OrderSource, type OrderSourceFilter } from '../lib/order-source';

import { reportSources as reportSourceCodes, reportSourceValues as projectReportSources } from '../lib/order-source-values.mjs';
const reportSources=reportSourceCodes as OrderSource[];
const reportSourceValues=projectReportSources as (rows:Value[],filter?:OrderSourceFilter)=>{source:OrderSource|'RESIDUAL';value:number}[];
const residualColor='#aeb3bd';
const reportLabel=(source:string)=>source==='RESIDUAL'?ui.includedInTotal:sourceLabel(source);
const reportColor=(source:OrderSource|'RESIDUAL')=>source==='RESIDUAL'?residualColor:sourceColors[source];

export function OrderSourceBadge({source}:{source?:OrderSource}){
 return <Badge size="xs" variant="light" color={source==='WEBSITE'?'violet':'gray'} leftSection={source==='WEBSITE'?<CartIcon/>:undefined}>{sourceLabel(source)}</Badge>;
}
export function CartIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h3l3 12h12l2-9H6M8 15l-1 3h13"/><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/></svg>;}
export function SourceModeControl({value,onChange}:{value:string;onChange:(value:string)=>void}){return <SegmentedControl size="xs" color="yoleotard" aria-label={ui.chartMode} value={value} onChange={onChange} data={[{value:'standard',label:ui.standard},{value:'sources',label:ui.bySource}]}/>;}
export function SourceFilterControl({value,onChange,ariaLabel=ui.trendFilter}:{value:OrderSourceFilter;onChange:(value:OrderSourceFilter)=>void;ariaLabel?:string}){const legacy=value==='OTHER'||value==='UNKNOWN';const options=sourceOptions().filter(row=>row.value!=='OTHER'&&row.value!=='UNKNOWN');return <Select className="order-source-filter" size="xs" searchable clearable description={legacy?ui.savedScopeHelp:undefined} aria-label={ariaLabel} value={value} onChange={next=>onChange((next||'') as OrderSourceFilter)} data={legacy?[...options,{value,label:ui.savedScope,disabled:true}]:options}/>;}
type Value={source:OrderSource;value:number};
export function SourceBreakdownChart({rows,currency,period,onSource,showScope=true}:{rows:Value[];currency?:string;period:string;onSource:(source:OrderSource)=>void;showScope?:boolean}){
 const [donutRef,donutBounds]=useResizeObserver();
 const values=reportSourceValues(rows),total=values.reduce((n,row)=>n+row.value,0),percent=sourcePercentages(values.map(row=>row.value));
 const label=(value:number)=>currency?moneyLabel(value,currency):String(value);
 const holeWidth=Math.min(donutBounds.width||220,225)*.51,exactTotal=label(total);
 const visibleTotal=currency&&exactTotal.length*7.2>holeWidth?compactSourceAmount(total,currency).join(' '):exactTotal;
 const totalFont=Math.min(20,Math.max(12,holeWidth/Math.max(1,visibleTotal.length*.62)));
 let offset=0;
 return <div className="order-source-breakdown"><div className="order-source-donut" ref={donutRef}><svg viewBox="0 0 240 240" role="group" aria-label={ui.distribution}>
  <circle cx="120" cy="120" r="88" fill="none" stroke="#f0edf8" strokeWidth="43"/>
  {values.map((row,index)=>{const length=total?row.value/total*100:0,start=offset;offset+=length;return row.value>0&&<circle key={row.source} cx="120" cy="120" r="88" pathLength="100" fill="none" stroke={reportColor(row.source)} strokeWidth="43" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" role={row.source==='RESIDUAL'?'img':'button'} tabIndex={row.source==='RESIDUAL'?undefined:0} aria-label={`${reportLabel(row.source)}: ${label(row.value)}, ${percent[index]}%`} onClick={row.source==='RESIDUAL'?undefined:()=>onSource(row.source as OrderSource)} onKeyDown={event=>{if(row.source!=='RESIDUAL'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSource(row.source)}}}><title>{reportLabel(row.source)}: {label(row.value)} · {percent[index]}%</title></circle>})}
 </svg><div className="order-source-center"><strong style={{fontSize:totalFont,whiteSpace:"nowrap"}} title={exactTotal} aria-label={exactTotal}>{visibleTotal}</strong><small>{currency?ui.receipts:ui.totalOrders}</small><small>{financeMonth(period)}</small></div></div><div className="order-source-legend">{values.map((row,index)=>row.source==='RESIDUAL'?<p key="residual" className="order-source-scope">{ui.includedInTotal}: <b>{label(row.value)}</b> · {percent[index]}%. {ui.residualScope}</p>:<UnstyledButton key={row.source} disabled={!row.value} onClick={()=>onSource(row.source as OrderSource)} aria-label={`${sourceLabel(row.source)}: ${label(row.value)}, ${percent[index]}%`}><i style={{background:sourceColors[row.source]}}/><span>{sourceLabel(row.source)}</span><b>{label(row.value)}</b><small>{percent[index]}%</small></UnstyledButton>)}{!total&&<p role="status">{ui.empty}</p>}{showScope&&<p className="order-source-scope">{currency?ui.receiptsScope:ui.ordersScope}</p>}</div></div>;
}
function compactSourceAmount(value:number,currency:string){
 const rounded=(BigInt(value)+50n)/100n;
 const parts=new Intl.NumberFormat('ru-RU',{style:'currency',currency,currencyDisplay:'narrowSymbol',notation:'compact',maximumFractionDigits:0}).formatToParts(rounded);
 return [parts.filter(part=>['integer','group','decimal','fraction'].includes(part.type)).map(part=>part.value).join(''),parts.filter(part=>['compact','currency'].includes(part.type)).map(part=>part.value).join(' ')];
}
export function SourceTrendLegend({filter}:{filter:OrderSourceFilter}){return <div className="order-source-trend-legend">{reportSources.filter(source=>!filter||(filter==='NON_WEBSITE'?source!=='WEBSITE':source===filter)).map(source=><span key={source}><i style={{background:sourceColors[source]}}/>{sourceLabel(source)}</span>)}</div>;}
export function SourceTrendChart({rows,currency,filter,onSource,fillHeight=false,showFooter=true}:{rows:{month:string;breakdown:Value[]}[];currency?:string;filter:OrderSourceFilter;onSource:(source:OrderSourceFilter,period:string)=>void;fillHeight?:boolean;showFooter?:boolean}){
 const [ref,bounds]=useResizeObserver();
 const selected=(source:OrderSource)=>!filter||(filter==='NON_WEBSITE'?source!=='WEBSITE':source===filter);
 const points=rows.map(row=>({...row,total:row.breakdown.filter(x=>selected(x.source)).reduce((n,x)=>n+x.value,0)})),max=Math.max(...points.map(row=>row.total),1),label=(value:number)=>currency?moneyLabel(value,currency):String(value);
 // Coordinates track the container: font sizes stay physical CSS pixels on a narrow card.
 const width=Math.max(240,bounds.width||400),height=fillHeight?Math.max(235,Math.round(bounds.height||235)):235,left=currency?78:32,right=12,bottom=height-40,plotHeight=bottom-50,step=(width-left-right)/Math.max(1,rows.length),barWidth=Math.min(38,step*.55);
 const labelEvery=Math.max(1,Math.ceil(48/step)),monthEvery=Math.max(1,Math.ceil(38/step));
 const ticks=[...new Set([0,1,2,3].map(n=>Math.ceil(max*n/3)))];
 return <div className={`order-source-trend${fillHeight?' is-fill-height':''}`}><div className="order-source-plot" ref={ref}><svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ui.dynamics}>
 {ticks.map(value=>{const y=bottom-value/max*plotHeight;return <g key={value}><line x1={left} x2={width-right} y1={y} y2={y} stroke="#e8e4f5"/><text x={left-7} y={y+4} textAnchor="end">{currency?compactSourceAmount(value,currency).join(' '):value}</text></g>})}
 {points.map((point,index)=>{let y=bottom;const x=left+index*step+step/2-barWidth/2,lines=currency?compactSourceAmount(point.total,currency):[String(point.total)];
 return <g key={point.month}>{index%labelEvery===0&&<text x={x+barWidth/2} y={Math.max(15,bottom-point.total/max*plotHeight-(lines.length>1?22:8))} textAnchor="middle" className="order-source-bar-value"><title>{label(point.total)}</title>{lines.map((line,i)=><tspan key={i} x={x+barWidth/2} dy={i?13:0}>{line}</tspan>)}</text>}
 {reportSourceValues(point.breakdown,filter).filter(row=>row.value>0).map(row=>{const size=row.value/max*plotHeight;y-=size;return <rect key={row.source} x={x} y={y} width={barWidth} height={size} fill={reportColor(row.source)} role={row.source==='RESIDUAL'?'img':'button'} tabIndex={row.source==='RESIDUAL'?undefined:0} aria-label={`${financeMonth(point.month)} · ${reportLabel(row.source)}: ${label(row.value)}`} onClick={row.source==='RESIDUAL'?undefined:()=>onSource(row.source as OrderSource,point.month)} onKeyDown={event=>{if(row.source!=='RESIDUAL'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSource(row.source,point.month)}}}><title>{financeMonth(point.month)} · {reportLabel(row.source)}: {label(row.value)}</title></rect>})}
 {index%monthEvery===0&&<text x={x+barWidth/2} y={height-14} textAnchor="middle">{new Intl.DateTimeFormat('ru-RU',{month:'short',timeZone:'UTC'}).format(new Date(`${point.month}-01T12:00:00Z`))}</text>}</g>})}</svg></div>
 {points.some(point=>reportSourceValues(point.breakdown,filter).some(row=>row.source==='RESIDUAL'))&&<p className="order-source-scope">{ui.residualScope}</p>}
 {!showFooter&&!points.some(row=>row.total)&&<p className="order-source-empty" role="status">{ui.empty}</p>}
 {showFooter&&<><SourceTrendLegend filter={filter}/>{!points.some(row=>row.total)&&<p role="status">{ui.empty}</p>}<p className="order-source-scope">{currency?ui.receiptsScope:ui.ordersScope}</p></>}</div>;
}
