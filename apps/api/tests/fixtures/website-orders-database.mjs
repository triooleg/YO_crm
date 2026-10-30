// Isolated transactional repository fake. No environment files, network or real database.
export function websiteDatabase(){
 const state=Object.fromEntries(['order','orderItem','orderItemInstance','payment','client','clientMergeRedirect','keycrmClientLink','auditLog','activity','productionSlot','orderShipment','shipment','athlete','measurement'].map(k=>[k,[]]));
 let serial=0,queue=Promise.resolve();const copy=v=>structuredClone(v);
 function matches(row,where={}){return Object.entries(where).every(([key,value])=>{
  if(key==='OR')return value.some(w=>matches(row,w));if(key==='AND')return value.every(w=>matches(row,w));
  if(key.includes('_')&&!Object.hasOwn(row,key))return matches(row,value);
  const current=row[key];if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,v])=>op==='path'?value.equals===v.reduce((o,k)=>o?.[k],current):op==='equals'?true:op==='in'?v.includes(current):op==='notIn'?current!=null&&!v.includes(current):op==='not'?current!==v:op==='gte'?current>=v:op==='lt'?current<v:op==='startsWith'?current?.startsWith(v):current?.[op]===v);
  return value===null?current==null:current===value;
 });}
 const db={state,async $transaction(run){let release;const before=queue;queue=new Promise(r=>release=r);await before;const snapshot=copy(state);try{return await run(db);}catch(e){for(const k of Object.keys(state))state[k]=snapshot[k];throw e;}finally{release();}},async $executeRawUnsafe(){return 0;},async $queryRawUnsafe(sql,...args){if(sql.includes('"Client"')){const [email,phone,uaPhone,localPhone]=args;return copy(state.client.filter(c=>(email&&c.email?.trim().toLowerCase()===email)||(phone&&c.phone?.replace(/\D/g,'')===phone)||(uaPhone&&c.phone?.replace(/\D/g,'')===uaPhone)||(localPhone&&c.phone?.replace(/\D/g,'')===localPhone)));}throw Error('UNEXPECTED_QUERY');}};
 for(const name of Object.keys(state))db[name]={
  async findUnique({where,include}){const row=copy(state[name].find(r=>matches(r,where))??null);if(row&&name==='order'&&include){row.shipment=copy(state.shipment.find(s=>s.orderId===row.id)??null);row.orderShipments=copy(state.orderShipment.filter(s=>s.orderId===row.id&&!s.archivedAt));}return row;},
  async findFirst({where={},orderBy}){let rows=state[name].filter(r=>matches(r,where));if(orderBy?.number==='desc')rows.sort((a,b)=>b.number.localeCompare(a.number));return copy(rows[0]??null);},
  async findMany({where={},orderBy}={}){const rows=state[name].filter(r=>matches(r,where));if(orderBy?.ordinal)rows.sort((a,b)=>a.ordinal-b.ordinal);return copy(rows);},
  async create({data}){const row={id:`${name}-${++serial}`,createdAt:new Date(),updatedAt:new Date(),archivedAt:null,voidedAt:null,athleteId:null,measurementId:null,productionStatus:'NOT_SCHEDULED',salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',paymentStatus:'UNPAID',...copy(data)};state[name].push(row);return copy(row);},
  async update({where,data}){const row=state[name].find(r=>matches(r,where));if(!row)throw Error('NOT_FOUND');Object.assign(row,copy(data),{updatedAt:new Date()});return copy(row);},
  async count({where}={}){return state[name].filter(r=>matches(r,where)).length;},
 };
 return db;
}
