type Person={id:string};
type Piece={id?:string;archivedAt?:unknown;athlete?:Person|null};
type Item={id?:string;quantity:number;archivedAt?:unknown;modelImagePath?:string|null;instances?:Piece[];athlete?:Person|null};
type OrderCompositionView={items:Item[];compositionManaged?:boolean;modelImagePath?:string|null;athlete?:Person|null;_count?:{items:number}};
const active=(order:OrderCompositionView)=>order.items.filter(item=>!item.archivedAt);
const managed=(order:OrderCompositionView)=>Boolean(order.compositionManaged||order._count?.items||order.items.some(item=>item.archivedAt));
export function orderCostumeQuantity(order:OrderCompositionView){const items=active(order);return items.length?items.reduce((sum,item)=>sum+item.quantity,0):managed(order)?0:1;}
export function orderAssignedAthleteCount(order:OrderCompositionView){
  const items=active(order),physical=items.some(item=>item.instances!==undefined);
  return physical?new Set(items.flatMap(item=>(item.instances??[]).filter(piece=>!piece.archivedAt).flatMap(piece=>piece.athlete?[piece.athlete.id]:[]))).size
    :new Set(items.flatMap(item=>item.athlete?[item.athlete.id]:[])).size||Number(Boolean(order.athlete));
}
export function orderDesignCount(order:OrderCompositionView){const items=active(order);return items.length?new Set(items.map((item,index)=>item.id??`legacy-${index}`)).size:managed(order)?0:1;}
export function orderDesignImagePaths(order:OrderCompositionView){
  const items=active(order);if(!items.length&&managed(order))return [];
  const paths=items.flatMap(item=>item.modelImagePath?[`/api/orders/images/${item.modelImagePath}`]:[]);
  if(order.modelImagePath&&!managed(order))paths.unshift(`/api/orders/images/${order.modelImagePath}`);
  return [...new Set(paths)];
}
