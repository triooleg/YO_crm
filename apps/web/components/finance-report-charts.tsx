"use client";
import { FinanceReportMonthPicker } from './finance-report-month-picker';
import { useId, useState, type ReactNode } from 'react';
import { SegmentedControl, Select, UnstyledButton, useMantineTheme } from '@mantine/core';
import { useResizeObserver } from '@mantine/hooks';
import { financeReportUi as ui, taxIntegrationFinanceUi as taxUi, taxAccountingUi } from '../lib/i18n';
import { fiscalAmountLabel } from '../lib/finance-tax-integration';
import type { TaxComponent } from '../lib/tax-integration-contract';
import { moneyLabel, financeMonth, type FinanceReport } from '../lib/finance-report';

export function FinanceReportCharts({report,range,onRange,onCategory,onTax,onMonth,initialMetric='received',sourceContent}:{report:FinanceReport;range:number;onRange:(range:number)=>void;onMonth:(month:string)=>void;onCategory:(id:string)=>void;onTax?:(component:TaxComponent)=>void;initialMetric?:'received'|'expenses'|'result';sourceContent?:ReactNode}){
  const gradientId=useId().replace(/:/g,'');
  const [metric,setMetric]=useState<string>(initialMetric);
  const [chartRef,chartRect]=useResizeObserver<HTMLDivElement>();
  const chartWidth=Math.max(240,Math.round(chartRect.width)||810),plotRight=chartWidth-6,plotWidth=Math.max(1,plotRight-58);
  const theme=useMantineTheme();
  const colors=[theme.other.financeReport.accent,theme.colors.pink[5],theme.colors.orange[4],theme.colors.blue[5],theme.colors.teal[4],theme.colors.indigo[4],theme.colors.grape[4]];
  const trend=report.fiscal?.trend??[];
  const barsFor=(row:typeof trend[number])=>metric==='result'?[{value:row.resultAfterAccrualMinor,label:taxUi.accrualResult,color:colors[0]}]:metric==='expenses'?[{value:row.ordinaryExpensesMinor,label:taxUi.expenses,color:colors[2]},{value:row.accruedTaxesMinor,label:taxUi.taxes,color:colors[1]}]:[{value:row.receivedMinor,label:taxUi.received,color:colors[0]},{value:row.ordinaryExpensesMinor,label:taxUi.expenses,color:colors[2]},{value:row.accruedTaxesMinor,label:taxUi.taxes,color:colors[1]}];
  const values=trend.flatMap(row=>barsFor(row).flatMap(bar=>bar.value==null?[]:[bar.value]));
  // Round display-only axis ticks; monetary report values remain integer minor units.
  const low=Math.min(0,...values),high=Math.max(1,...values),rawStep=(high-low)/4;
  const magnitude=10**Math.floor(Math.log10(rawStep)),stepSize=([1,2,2.5,3,5,10].find(value=>value*magnitude>=rawStep)||10)*magnitude;
  const min=Math.max(-Number.MAX_SAFE_INTEGER,Math.floor(low/stepSize)*stepSize),max=Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(high/stepSize)*stepSize),span=max-min;
  // Keep an explicit top label band and a separate baseline band for paired expenses.
  const y=(value:number)=>145-(value-min)/span*(metric==='expenses'?107:121),zero=y(0),step=trend.length?plotWidth/trend.length:plotWidth;
  const valueLabelY=(value:number)=>value<0?y(value)+13:y(value)-7;
  const taxLabelY=(value:number,expense:number|null)=>{
    const above=Math.min(zero,y(value))-7;
    return expense!=null&&Math.abs(above-valueLabelY(expense))<14?Math.min(above,valueLabelY(expense))-14:above;
  };
  const structure=report.fiscal?.expenseStructure,total=structure?.totalMinor,structureRows=structure?.rows??[];
  const categoryName=(row:typeof structureRows[number])=>row.kind==='TAX'&&row.component?taxAccountingUi.components[row.component]:report.options.categories.find(category=>category.id===row.categoryId)?.name||ui.category;
  const selectCategory=(row:typeof structureRows[number])=>row.kind==='TAX'&&row.component?onTax?.(row.component):row.categoryId&&onCategory(row.categoryId);
  let cumulative=0;
  return <section className="finance-report-charts">
    {sourceContent??<article className="finance-report-card finance-report-trend"><header><h2>{taxUi.dynamics}</h2><SegmentedControl color="yoleotard" size="xs" value={metric} onChange={setMetric} data={[{value:'received',label:ui.incomeTab},{value:'expenses',label:ui.expenses},{value:'result',label:ui.resultTab}]}/><Select aria-label={ui.range} value={String(range)} onChange={value=>value&&onRange(Number(value))} data={[{value:'3',label:ui.months3},{value:'6',label:ui.months6},{value:'12',label:ui.months12}]} allowDeselect={false} size="xs"/></header>
      <div className="finance-report-plot" ref={chartRef}>{trend.length?<svg className="finance-report-bar-chart" viewBox={`0 0 ${chartWidth} 185`} role="img" aria-label={`${ui.dynamics}: ${report.currency}`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={theme.other.financeReport.accent}/><stop offset="100%" stopColor={theme.other.financeReport.accentEnd}/></linearGradient></defs>
        {[0,1,2,3,4].map(index=>{const value=min+span*index/4;return <g key={index}><line x1="58" x2={plotRight} y1={y(value)} y2={y(value)} stroke="var(--line)"/><text x="51" y={y(value)+4} textAnchor="end" className="finance-chart-axis">{moneyLabel(Math.max(min,Math.min(max,Math.round(value))),report.currency).replace(/,00(?=\D*$)/,'')}</text></g>})}
        <line x1="58" x2={plotRight} y1={zero} y2={zero} stroke="var(--muted)" strokeOpacity=".4"/>
        {trend.map((row,index)=>{const bars=barsFor(row);const width=Math.min(32,step/(bars.length+2));return <g key={row.month}>
          {bars.map((bar,j)=>{const x=58+step*(index+.5)+(j-bars.length/2)*width*1.2;if(bar.value==null)return <g key={j} role="img" aria-label={`${financeMonth(row.month)}, ${bar.label}: ${taxUi.unknown}`}><text x={x} y={zero-5} className="finance-chart-axis">?</text></g>;return <g key={j} tabIndex={0} role="img" aria-label={`${financeMonth(row.month)}, ${bar.label}: ${moneyLabel(bar.value,report.currency)}`}><title>{`${financeMonth(row.month)} · ${bar.label}: ${moneyLabel(bar.value,report.currency)}`}</title><rect data-series={bar.label} x={x} y={Math.min(zero,y(bar.value))} width={width} height={Math.abs(y(bar.value)-zero)} rx="3" fill={bar.value<0?theme.colors.red[5]:bar.color===colors[0]?`url(#${gradientId})`:bar.color}/>{range<=6&&chartWidth>=600&&(j===0||metric==='expenses')&&<text data-series={bar.label} x={x+width/2} y={metric==='expenses'&&j===1?taxLabelY(bar.value,row.ordinaryExpensesMinor):valueLabelY(bar.value)} textAnchor="middle" fill={bar.color} className="finance-chart-value">{moneyLabel(bar.value,report.currency)}</text>}</g>})}
          <text x={58+step*(index+.5)} y="175" textAnchor="middle" className="finance-chart-axis">{new Date(`${row.month}-01T12:00:00Z`).toLocaleDateString('ru-RU',{month:range<=6&&chartWidth>=500?'long':'short',timeZone:'UTC'})}</text>
        </g>})}
      </svg>:<p className="finance-report-empty">{ui.empty}</p>}</div>
      <div className="finance-report-legend">{(trend[0]?barsFor(trend[0]):[]).map(bar=><span key={bar.label}><i style={{background:bar.color}}/>{bar.label}</span>)}</div>{trend.some(row=>row.incomplete)&&<p role="status" className="finance-report-info">{taxUi.provisional}</p>}
    </article>}
    <article className="finance-report-card finance-report-breakdown"><header><h2>{taxUi.expenseStructure}</h2><FinanceReportMonthPicker month={report.month} label={ui.expenseMonth} onChange={onMonth} compact/></header>
      {total!=null&&total>0&&structure?.drawable?<div className="finance-report-donut-content"><svg data-expense-structure="accrued" viewBox="0 0 220 220" role="img" aria-label={`${ui.expenseStructure}: ${moneyLabel(total,report.currency)}`}>
        {structureRows.map((row,index)=>{if(row.amountMinor==null||row.amountMinor<=0)return null;const share=row.amountMinor/total,offset=cumulative;cumulative+=share;const angle=(offset+share/2)*2*Math.PI-Math.PI/2;return <g key={(row.categoryId??row.component)} role="button" tabIndex={0} aria-label={`${categoryName(row)}: ${fiscalAmountLabel(row.amountMinor,report.currency)}, ${row.percent}%`} onClick={()=>selectCategory(row)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCategory(row)}}}><title>{`${categoryName(row)}: ${fiscalAmountLabel(row.amountMinor,report.currency)} (${row.percent}%)`}</title><circle cx="110" cy="110" r="83" fill="none" stroke={colors[index%colors.length]} strokeWidth="43" pathLength="100" strokeDasharray={`${share*100} ${100-share*100}`} strokeDashoffset={-offset*100} transform="rotate(-90 110 110)"/>{share>=.06&&<text x={110+83*Math.cos(angle)} y={114+83*Math.sin(angle)} textAnchor="middle" fill="white" className="finance-donut-percent">{row.percent}%</text>}</g>})}
        <text x="110" y="103" textAnchor="middle" className="finance-donut-total">{moneyLabel(total,report.currency)}</text><text x="110" y="124" textAnchor="middle" className="finance-chart-axis">{taxUi.expensesAndTaxes}</text><text x="110" y="141" textAnchor="middle" className="finance-chart-axis">{financeMonth(report.month)}</text>
      </svg><div className="finance-report-category-list">{structureRows.map((row,index)=><UnstyledButton type="button" key={(row.categoryId??row.component)} onClick={()=>selectCategory(row)}><i style={{background:colors[index%colors.length]}}/><span>{categoryName(row)}</span><b>{fiscalAmountLabel(row.amountMinor,report.currency)}</b><small>{row.percent}%</small></UnstyledButton>)}<p className="finance-report-info">ⓘ {taxUi.expenseHint}</p></div></div>:<div className="finance-report-donut-content"><div className="finance-report-structure-unavailable"><strong>{fiscalAmountLabel(total,report.currency)}</strong><p>{taxUi.expensesAndTaxes}</p><p role="status">{total===0?ui.emptyExpenses:taxUi.signedStructure}</p></div><div className="finance-report-category-list">{structureRows.map((row,index)=><UnstyledButton key={row.categoryId??row.component} onClick={()=>selectCategory(row)}><i style={{background:colors[index%colors.length]}}/><span>{categoryName(row)}</span><b>{fiscalAmountLabel(row.amountMinor,report.currency)}</b><small>—</small></UnstyledButton>)}<p className="finance-report-info">{taxUi.expenseHint}</p></div></div>}
    </article>
  </section>;
}
