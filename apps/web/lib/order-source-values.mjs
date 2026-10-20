const orderSources=['WEBSITE','MANUAL','INSTAGRAM','FACEBOOK','CHAT','WHATSAPP','VIBER','EMAIL','OTHER','UNKNOWN'];
export const reportSources=orderSources.filter(source=>source!=='OTHER'&&source!=='UNKNOWN');
/** Report presentation only: omitted categories remain in totals as a passive residual. */
export function reportSourceValues(rows,filter=''){
 const selected=source=>!filter||(filter==='NON_WEBSITE'?source!=='WEBSITE':source===filter);
 const named=reportSources.filter(selected).map(source=>({source,value:rows.filter(row=>row.source===source).reduce((sum,row)=>sum+row.value,0)}));
 const residual=rows.filter(row=>selected(row.source)&&!reportSources.includes(row.source)).reduce((sum,row)=>sum+row.value,0);
 return residual?[...named,{source:'RESIDUAL',value:residual}]:named;
}
export function parseSource(value){return value==='NON_WEBSITE'||orderSources.includes(value)?value:'';}
/** Largest remainders: nonempty distributions total exactly 100%, with stable ties. */
export function sourcePercentages(values){
 const amounts=values.map(value=>BigInt(value)),total=amounts.reduce((n,value)=>n+value,0n);
 if(total===0n)return values.map(()=>0);
 const rows=amounts.map((value,index)=>({index,whole:Number(value*100n/total),remainder:value*100n%total}));
 let left=100-rows.reduce((n,row)=>n+row.whole,0);
 for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(left--<=0)break;row.whole++;}
 return rows.map(row=>row.whole);
}
