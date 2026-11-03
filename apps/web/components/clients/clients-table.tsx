"use client";
import {Badge,Button,Checkbox,Group,NativeSelect,Pagination,ScrollArea,Table,Text,UnstyledButton} from "@mantine/core";
import {orderDisplayNumber} from "../../lib/order-source";
import {ClientAvatar} from "../client-avatar";
import {clientsWorkspaceUi as ui} from "../../lib/clients-workspace-i18n";
import {Channel,Contact,Country,RequestState,stamp} from "./presentation";
import type {ClientList,ClientRow,WorkspaceQuery} from "./types";
type Props={data?:ClientList;error?:string;retry:()=>void;query:WorkspaceQuery;onQuery:(patch:Partial<WorkspaceQuery>)=>void;onSelect:(id:string,tab?:WorkspaceQuery["tab"])=>void;checked:Map<string,ClientRow>;onCheck:(rows:ClientRow[],checked:boolean)=>void;onOrder:(id:string)=>void};
export function ClientsTable({data,error,retry,query,onQuery,onSelect,checked,onCheck,onOrder}:Props){
 const rows=data?.items??[],all=rows.length>0&&rows.every(row=>checked.has(row.id)),some=rows.some(row=>checked.has(row.id));
 function sort(key:WorkspaceQuery["sort"]){onQuery({sort:key,direction:query.sort===key&&query.direction==="desc"?"asc":"desc",page:1});}
 function heading(key:WorkspaceQuery["sort"],label:string){return <UnstyledButton className="clients-sort" onClick={()=>sort(key)}>{label}{query.sort===key?<span aria-hidden="true">{query.direction==="desc"?" ↓":" ↑"}</span>:null}</UnstyledButton>;}
 return <section className="clients-table-panel" aria-label={ui.title}>
  <RequestState error={error} retry={retry} loading={!data&&!error}/>
  {data&&<><ScrollArea type="auto" offsetScrollbars><Table className="clients-table" highlightOnHover verticalSpacing="sm" horizontalSpacing="sm"><Table.Thead><Table.Tr>
   <Table.Th><Checkbox aria-label={ui.selectAll} checked={all} indeterminate={some&&!all} onChange={e=>onCheck(rows,e.currentTarget.checked)}/></Table.Th>
   <Table.Th aria-sort={query.sort==="name"?(query.direction==="asc"?"ascending":"descending"):"none"}>{heading("name",ui.client)}</Table.Th><Table.Th>{ui.contacts}</Table.Th>
   <Table.Th aria-sort={query.sort==="orderCount"?(query.direction==="asc"?"ascending":"descending"):"none"}>{heading("orderCount",ui.orders)}</Table.Th>
   <Table.Th aria-sort={query.sort==="latestOrder"?(query.direction==="asc"?"ascending":"descending"):"none"}>{heading("latestOrder",ui.latestOrder)}</Table.Th>
   <Table.Th aria-sort={query.sort==="createdAt"?(query.direction==="asc"?"ascending":"descending"):"none"}>{heading("createdAt",ui.createdAt)}</Table.Th>
  </Table.Tr></Table.Thead><Table.Tbody>{rows.map(row=><Table.Tr key={row.id} className={query.clientId===row.id?"is-selected":undefined} data-selected={query.clientId===row.id||undefined} onClick={()=>onSelect(row.id)}>
   <Table.Td onClick={e=>e.stopPropagation()}><Checkbox aria-label={`${ui.select}: ${row.displayName}`} checked={checked.has(row.id)} onChange={e=>onCheck([row],e.currentTarget.checked)}/></Table.Td>
   <Table.Td><div className="clients-person"><ClientAvatar displayName={row.displayName} avatarUrl={row.avatarUrl} className="clients-avatar"/><div className="clients-person-text"><Group gap={5} wrap="nowrap"><UnstyledButton className="clients-name" onClick={e=>{e.stopPropagation();onSelect(row.id);}} title={row.displayName}>{row.displayName}</UnstyledButton><span className="clients-channels">{row.channels?.map(channel=><Channel key={channel} value={channel}/>)}</span></Group><Country value={row.country}/></div></div></Table.Td>
   <Table.Td><Contact value={row.email}/><Contact value={row.phone}/></Table.Td>
   <Table.Td><UnstyledButton aria-label={`${ui.orders}: ${row.displayName}, ${row.orderCount}`} onClick={e=>{e.stopPropagation();onSelect(row.id,"orders");}}><Badge color="yoleotard" variant="light" size="lg">{row.orderCount}</Badge></UnstyledButton></Table.Td>
   <Table.Td>{row.latestOrder?<><Button variant="subtle" size="compact-xs" title={row.latestOrder.number} onClick={e=>{e.stopPropagation();onOrder(row.latestOrder!.id);}}>{orderDisplayNumber(row.latestOrder)}</Button><Text size="xs" c="dimmed">{stamp(row.latestOrder.createdAt)}</Text></>:ui.missing}</Table.Td><Table.Td><Text size="xs">{stamp(row.createdAt)}</Text></Table.Td>
  </Table.Tr>)}</Table.Tbody></Table></ScrollArea>{!rows.length&&<Text c="dimmed" p="xl" ta="center">{ui.empty}</Text>}
  <div className="clients-pagination"><Text size="xs" c="dimmed">{ui.shown} {data.total?((data.page-1)*data.pageSize+1):0}–{Math.min(data.page*data.pageSize,data.total)} {ui.of} {data.total}</Text><NativeSelect aria-label={ui.pageSize} value={query.pageSize} onChange={e=>onQuery({page:1,pageSize:Number(e.currentTarget.value) as 15|20|50})} data={[15,20,50].map(value=>({value:String(value),label:`${value} ${ui.pageSize.toLowerCase()}`}))}/><Pagination size="xs" total={Math.max(1,Math.ceil(data.total/data.pageSize))} value={data.page} onChange={page=>onQuery({page})} boundaries={1} siblings={0} aria-label={ui.pagination}/></div></>}
 </section>;
}
