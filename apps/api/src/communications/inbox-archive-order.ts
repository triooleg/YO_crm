type Row={id:string;conversationId:string;effectiveAt:Date;metadata:unknown};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;

/** Chronology is a partial order: equivalent copies may have different ordinals
 * in different source dialogues. Neither representative ordinal nor locale can
 * replace those per-dialogue constraints. Input is the existing SQL DESC order. */
export function orderArchiveMinuteTies<T extends Row>(descending:readonly T[]):T[]{
 const result:T[]=[];
 for(let start=0;start<descending.length;){
  let end=start+1;
  while(end<descending.length&&+descending[end]!.effectiveAt===+descending[start]!.effectiveAt)end++;
  const rows=descending.slice(start,end).reverse(),scopes=new Map<string,Map<number,Set<number>>>();
  rows.forEach((row,index)=>{
   const archive=object(object(row.metadata)?.historyArchive);
   if(archive?.policy!=='KEYCRM_SOURCE_ARCHIVE_V1'||!Array.isArray(archive.sourceVariants))return;
   for(const raw of archive.sourceVariants){
    const v=object(raw);if(typeof v?.ordinal!=='number'||!Number.isSafeInteger(v.ordinal)||v.ordinal<0||typeof v.sourceKey!=='string')continue;
    let key:unknown;try{key=JSON.parse(v.sourceKey);}catch{continue;}
    if(!Array.isArray(key)||key.length!==5||!key.every(x=>typeof x==='string'))continue;
    const scope=JSON.stringify([row.conversationId,...key.slice(0,4)]),ordinals=scopes.get(scope)??new Map<number,Set<number>>();
    const indices=ordinals.get(v.ordinal)??new Set<number>();indices.add(index);ordinals.set(v.ordinal,indices);scopes.set(scope,ordinals);
   }
  });
  const edges=rows.map(()=>new Set<number>()),incoming=rows.map(()=>0);
  const link=(from:number,to:number)=>{if(!edges[from]!.has(to)){edges[from]!.add(to);incoming[to]=incoming[to]!+1;}};
  for(const ordinals of scopes.values()){
   const buckets=[...ordinals.entries()].sort((a,b)=>a[0]-b[0]);
   let previous:number|undefined;
   // A barrier represents all members of the preceding bucket. This needs
   // O(variants) edges rather than the Cartesian product of adjacent buckets.
   for(const [,indices] of buckets){
    const barrier=edges.length;edges.push(new Set());incoming.push(0);
    for(const index of indices){if(previous!==undefined)link(previous,index);link(index,barrier);}
    previous=barrier;
   }
  }
  const ready=incoming.flatMap((count,index)=>count===0&&index<rows.length?[index]:[]),barriers:number[]=[],ordered:T[]=[];
  while(ready.length||barriers.length){
   const index=barriers.length?barriers.pop()!:ready.shift()!;if(index<rows.length)ordered.push(rows[index]!);
   for(const next of edges[index]!)if((incoming[next]=incoming[next]!-1)===0){
    if(next>=rows.length){barriers.push(next);continue;}
    let lo=0,hi=ready.length;while(lo<hi){const mid=(lo+hi)>>>1;if(ready[mid]!<next)lo=mid+1;else hi=mid;}ready.splice(lo,0,next);
   }
  }
  if(ordered.length!==rows.length)throw Error('Порядок сообщений архива противоречив: требуется проверка исходных диалогов');
  result.push(...ordered.reverse());start=end;
 }
 return result;
}
