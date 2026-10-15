"use client";
import { FinanceReportMonthPicker } from './finance-report-month-picker';
import { useId, useState } from 'react';
import { SegmentedControl, Select, UnstyledButton, useMantineTheme } from '@mantine/core';
import { useResizeObserver } from '@mantine/hooks';
import { financeReportUi as ui } from '../lib/i18n';
import { moneyLabel, financeMonth, type FinanceReport } from '../lib/finance-report';

export function FinanceReportCharts({report,range,onRange,onCategory,onMonth,initialMetric='received'}:{report:FinanceReport;range:number;onRange:(range:number)=>void;onMonth:(month:string)=>void;onCategory:(id:string)=>void;initialMetric?:'received'|'expenses'|'result'}){
  const gradientId=useId().replace(/:/g,'');
  const [metric,setMetric]=useState<string>(initialMetric);
  const [chartRef,chartRect]=useResizeObserver<HTMLDivElement>();
  const chartWidth=Math.max(240,Math.round(chartRect.width)||810),plotRight=chartWidth-6,plotWidth=Math.max(1,plotRight-58);
  const theme=useMantineTheme();
  const colors=[theme.other.financeReport.accent,theme.colors.pink[5],theme.colors.orange[4],theme.colors.blue[5],theme.colors.teal[4],theme.colors.indigo[4],theme.colors.grape[4]];
  const trend=report.monthlyTrend;
  const values=trend.flatMap(row=>metric==='result'?[row.resultMinor]:metric==='expenses'?[row.expensesMinor]:[row.receivedMinor,row.expensesMinor]);
  // Round display-only axis ticks; monetary report values remain integer minor units.
  const low=Math.min(0,...values),high=Math.max(1,...values),rawStep=(high-low)/4;
  const magnitude=10**Math.floor(Math.log10(rawStep)),stepSize=([1,2,2.5,3,5,10].find(value=>value*magnitude>=rawStep)||10)*magnitude;
  const min=Math.max(-Number.MAX_SAFE_INTEGER,Math.floor(low/stepSize)*stepSize),max=Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(high/stepSize)*stepSize),span=max-min;
  const y=(value:number)=>157-(value-min)/span*153,zero=y(0),step=trend.length?plotWidth/trend.length:plotWidth;
  const total=report.categoryBreakdown.reduce((sum,row)=>sum+row.amountMinor,0);
  let cumulative=0;
  return <section className="finance-report-charts">
    <article className="finance-report-card finance-report-trend"><header><h2>{ui.dynamics}</h2><SegmentedControl color="yoleotard" size="xs" value={metric} onChange={setMetric} data={[{value:'received',label:ui.incomeTab},{value:'expenses',label:ui.expenses},{value:'result',label:ui.resultTab}]}/><Select aria-label={ui.range} value={String(range)} onChange={value=>value&&onRange(Number(value))} data={[{value:'3',label:ui.months3},{value:'6',label:ui.months6},{value:'12',label:ui.months12}]} allowDeselect={false} size="xs"/></header>
      <div className="finance-report-plot" ref={chartRef}>{trend.length?<svg className="finance-report-bar-chart" viewBox={`0 0 ${chartWidth} 185`} role="img" aria-label={`${ui.dynamics}: ${report.currency}`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={theme.other.financeReport.accent}/><stop offset="100%" stopColor={theme.other.financeReport.accentEnd}/></linearGradient></defs>
        {[0,1,2,3,4].map(index=>{const value=min+span*index/4;return <g key={index}><line x1="58" x2={plotRight} y1={y(value)} y2={y(value)} stroke="var(--line)"/><text x="51" y={y(value)+4} textAnchor="end" className="finance-chart-axis">{moneyLabel(Math.max(min,Math.min(max,Math.round(value))),report.currency).replace(/,00(?=\D*$)/,'')}</text></g>})}
        <line x1="58" x2={plotRight} y1={zero} y2={zero} stroke="var(--muted)" strokeOpacity=".4"/>
        {trend.map((row,index)=>{const bars=metric==='result'?[{value:row.resultMinor,label:ui.result,color:colors[0]}]:metric==='expenses'?[{value:row.expensesMinor,label:ui.expenses,color:colors[2]}]:[{value:row.receivedMinor,label:ui.received,color:colors[0]},{value:row.expensesMinor,label:ui.expenses,color:colors[2]}];const width=Math.min(32,step/(bars.length+2));return <g key={row.month}>
          {bars.map((bar,j)=>{const x=58+step*(index+.5)+(j-bars.length/2)*width*1.2;return <g key={j} tabIndex={0} role="img" aria-label={`${financeMonth(row.month)}, ${bar.label}: ${moneyLabel(bar.value,report.currency)}`}><title>{`${financeMonth(row.month)} · ${bar.label}: ${moneyLabel(bar.value,report.currency)}`}</title><rect x={x} y={Math.min(zero,y(bar.value))} width={width} height={Math.abs(y(bar.value)-zero)} rx="3" fill={bar.value<0?theme.colors.red[5]:bar.color===colors[0]?`url(#${gradientId})`:bar.color}/>{range<=6&&chartWidth>=600&&<text x={x+width/2} y={bar.value<0?y(bar.value)+13:y(bar.value)-7} textAnchor="middle" fill={bar.color} className="finance-chart-value">{moneyLabel(bar.value,report.currency)}</text>}</g>})}
          <text x={58+step*(index+.5)} y="175" textAnchor="middle" className="finance-chart-axis">{new Date(`${row.month}-01T12:00:00Z`).toLocaleDateString('ru-RU',{month:range<=6&&chartWidth>=500?'long':'short',timeZone:'UTC'})}</text>
        </g>})}
      </svg>:<p className="finance-report-empty">{ui.empty}</p>}</div>
      <div className="finance-report-legend">{metric!=='expenses'&&<span><i style={{background:colors[0]}}/>{metric==='result'?ui.result:ui.received}</span>}{metric!=='result'&&<span><i style={{background:colors[2]}}/>{ui.expenses}</span>}</div>
    </article>
    <article className="finance-report-card finance-report-breakdown"><header><h2>{ui.expenseStructure}</h2><FinanceReportMonthPicker month={report.month} label={ui.expenseMonth} onChange={onMonth} compact/></header>
      {total>0?<div className="finance-report-donut-content"><svg viewBox="0 0 220 220" role="img" aria-label={`${ui.expenseStructure}: ${moneyLabel(total,report.currency)}`}>
        {report.categoryBreakdown.map((row,index)=>{const share=row.amountMinor/total,offset=cumulative;cumulative+=share;const angle=(offset+share/2)*2*Math.PI-Math.PI/2;return <g key={row.id} role="button" tabIndex={0} aria-label={`${row.name}: ${moneyLabel(row.amountMinor,report.currency)}, ${(share*100).toFixed(1)}%`} onClick={()=>onCategory(row.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onCategory(row.id)}}}><title>{`${row.name}: ${moneyLabel(row.amountMinor,report.currency)} (${(share*100).toFixed(1)}%)`}</title><circle cx="110" cy="110" r="83" fill="none" stroke={colors[index%colors.length]} strokeWidth="43" pathLength="100" strokeDasharray={`${share*100} ${100-share*100}`} strokeDashoffset={-offset*100} transform="rotate(-90 110 110)"/>{share>=.06&&<text x={110+83*Math.cos(angle)} y={114+83*Math.sin(angle)} textAnchor="middle" fill="white" className="finance-donut-percent">{Math.round(share*100)}%</text>}</g>})}
        <text x="110" y="103" textAnchor="middle" className="finance-donut-total">{moneyLabel(total,report.currency)}</text><text x="110" y="124" textAnchor="middle" className="finance-chart-axis">{ui.expenses}</text><text x="110" y="141" textAnchor="middle" className="finance-chart-axis">{financeMonth(report.month)}</text>
      </svg><div className="finance-report-category-list">{report.categoryBreakdown.map((row,index)=><UnstyledButton type="button" key={row.id} onClick={()=>onCategory(row.id)}><i style={{background:colors[index%colors.length]}}/><span>{row.name}</span><b>{moneyLabel(row.amountMinor,report.currency)}</b><small>{Math.round(row.amountMinor/total*100)}%</small></UnstyledButton>)}<p className="finance-report-info">ⓘ {ui.expenseChartHint}</p></div></div>:<p className="finance-report-empty">{ui.emptyExpenses}</p>}
    </article>
  </section>;
}
