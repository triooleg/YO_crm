"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {Alert,Button,Drawer,Group,Modal,Paper,Select,SimpleGrid,Text,TextInput,ThemeIcon,Title} from "@mantine/core";
import {useMediaQuery} from "@mantine/hooks";
import {CrmNavIcon} from "./crm-nav-icon";
import {MeasurementPanel} from "./measurement-panel";
import {OrderPanel} from "./order-panel";
import {clientAthleteUi} from "../lib/i18n";
import {clientsWorkspaceUi as ui} from "../lib/clients-workspace-i18n";
import {CrmActionIcon,CrmButton,CrmNativeSelect,CrmTextInput} from "./crm/settings-controls";
import {ClientDetails} from "./clients/client-details";
import {ClientsTable} from "./clients/clients-table";
import {CreateClient,Duplicates,MergeClients} from "./clients/client-dialogs";
import {clientRequest,failure} from "./clients/api";
import {RequestState} from "./clients/presentation";
import {measurementIsStale,clientForNewOrder} from "./clients/helpers.mjs";
import {useWorkspace} from "./clients/use-workspace";
import type {ClientRow,Navigate,WorkspaceTab} from "./clients/types";
import "./clients/styles.css";
export function ClientWorkspace({onNavigate,role}:{onNavigate?:Navigate;role?:string}={}){
 const state=useWorkspace(),{query,update,detail}=state;
 const desktop=useMediaQuery("(min-width: 75em)",false),mobile=useMediaQuery("(max-width: 45em)",false);
 const [checked,setChecked]=useState(new Map<string,ClientRow>()),[creating,setCreating]=useState(false),[duplicates,setDuplicates]=useState(false),[mergeRows,setMergeRows]=useState<ClientRow[]>(),[flow,setFlow]=useState<"order"|"measure"|"athlete"|"review-measurements">(),[allowStale,setAllowStale]=useState(false),[initialAthleteId,setInitialAthleteId]=useState<string>(),[overlay,setOverlay]=useState(false),[moreFilters,setMoreFilters]=useState(false);
 const addAthleteTriggerRef=useRef<HTMLButtonElement>(null),createClientTriggerRef=useRef<HTMLButtonElement>(null),mergeTriggerRef=useRef<HTMLButtonElement>(null),duplicateTriggerRef=useRef<HTMLButtonElement>(null);
 const originOrder=useRef<string|undefined>(undefined);
 const [returnChat,setReturnChat]=useState<{conversationId:string;channel:string;clientId:string;clientName:string}>();
 useEffect(()=>{const params=new URLSearchParams(window.location.search),conversationId=params.get("returnConversationId"),channel=params.get("returnChannel"),clientId=params.get("clientId");if(clientId&&conversationId&&channel&&ui.channels[channel])setReturnChat({conversationId,channel,clientId,clientName:params.get("clientName")??""});},[]);
 useEffect(()=>{originOrder.current=new URLSearchParams(window.location.search).get("orderId")??undefined;if(originOrder.current&&!new URLSearchParams(window.location.search).has("tab"))update({tab:"orders"});},[]);
 useEffect(()=>{if(desktop&&state.list?.items[0]&&!query.clientId)update({clientId:state.list.items[0].id});},[desktop,state.list,query.clientId,update]);
 useEffect(()=>{if(!detail)return;const url=new URL(window.location.href);if(url.searchParams.get("action")==="new-order"){newOrder();url.searchParams.delete("action");url.searchParams.delete("clientName");window.history.replaceState(null,"",url.pathname+url.search+url.hash);}},[detail]);
 useEffect(()=>{setFlow(undefined);setOverlay(false);setInitialAthleteId(undefined);setAllowStale(false);},[query.clientId]);
 function select(id:string,tab:WorkspaceTab="overview"){originOrder.current=undefined;update({clientId:id,tab},true);}
 function onCheck(rows:ClientRow[],value:boolean){setChecked(previous=>{const next=new Map(previous);for(const row of rows)if(value)next.set(row.id,row);else next.delete(row.id);return next;});}
 function onOrder(id:string){if(onNavigate)onNavigate("orders",{orderId:id});else window.location.assign(`/?section=orders&orderId=${encodeURIComponent(id)}`);}
 function newOrder(athleteId?:string){setInitialAthleteId(athleteId);setAllowStale(false);setFlow(detail?.athletes.some(athlete=>athlete.measurements[0]&&measurementIsStale(athlete.measurements[0]))?"review-measurements":"order");}
 function saved(){setFlow(undefined);setInitialAthleteId(undefined);state.refresh();}
 function closeDetail(){update({clientId:"",tab:"overview"});}
 const detailContent=detail?<ClientDetails key={detail.id} currency={query.currency} onCurrency={currency=>update({currency})} client={detail} tab={query.tab} onTab={tab=>update({tab})} onOrder={onOrder} onNewOrder={newOrder} onMeasure={()=>setFlow("measure")} onAddAthlete={()=>setFlow("athlete")} onRefresh={state.refresh} revision={state.revision} onNavigate={onNavigate} addAthleteRef={addAthleteTriggerRef} focusedOrderId={originOrder.current} onOverlayChange={setOverlay}/>:query.clientId?<RequestState error={state.detailError} retry={state.refresh} loading={!state.detailError}/>:<Text c="dimmed" p="xl" ta="center">{ui.choose}</Text>;
 const [archiveTarget,setArchiveTarget]=useState<ClientRow>();
 const [archiving,setArchiving]=useState(false);
 const [archiveError,setArchiveError]=useState("");
 const archivePending=useRef(false);
 const searchRef=useRef<HTMLInputElement>(null);
 const archiveTrigger=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{
  if(!archiveTarget&&archiveTrigger.current){
   const trigger=archiveTrigger.current;
   archiveTrigger.current=null;
   if(trigger.isConnected)trigger.focus();
   else searchRef.current?.focus();
  }
 },[archiveTarget]);
 const canArchive=role==="OWNER"||role==="ADMIN";
 function openArchive(row:ClientRow,trigger:HTMLButtonElement){
  archiveTrigger.current=trigger;
  setArchiveError("");
  setArchiveTarget(row);
 }
 function closeArchive(){
  if(!archivePending.current)setArchiveTarget(undefined);
 }
 async function archiveClient(){
  if(archivePending.current||!archiveTarget?.updatedAt)return;
  const row=archiveTarget;
  archivePending.current=true;
  setArchiving(true);
  setArchiveError("");
  try{
   await clientRequest(`/clients/${encodeURIComponent(row.id)}/archive`,{
    method:"PATCH",body:JSON.stringify({expectedUpdatedAt:row.updatedAt}),
   });
   onCheck([row],false);
   state.onClientArchived(row.id);
   setArchiveTarget(undefined);
  }catch(error){
   setArchiveError(failure(error));
   state.refresh();
  }finally{
   archivePending.current=false;
   setArchiving(false);
  }
 }
 const options=state.list?.filters;
 const statistics=state.list?.statistics;
 const cards=[
  {label:ui.totalClients,value:state.list?.total,icon:"clients",color:"yoleotard"},
  {label:ui.activeClients,value:statistics?.active,icon:"tasks",color:"green"},
  {label:ui.leadClients,value:statistics?.leads,icon:"inbox",color:"blue"},
  {label:ui.repeatClients,value:statistics?.repeat,icon:"orders",color:"yoleotard"},
 ] as const;
 return <main className="clients-workspace">
  <header className="clients-page-header"><div><Text size="xs" fw={700} c="yoleotard">{ui.eyebrow}</Text><Title order={1}>{ui.title}</Title><Text size="sm" c="dimmed">{ui.subtitle}</Text></div><Group gap="xs" className="clients-header-actions"><Button ref={duplicateTriggerRef} variant="default" onClick={()=>setDuplicates(true)}>{ui.findDuplicates}</Button><Button ref={mergeTriggerRef} variant="default" disabled={checked.size<2} onClick={()=>setMergeRows([...checked.values()])}>{ui.merge}{checked.size?` (${checked.size})`:""}</Button><Button ref={createClientTriggerRef} onClick={()=>setCreating(true)}>{ui.create}</Button></Group></header>
  <section aria-label={ui.listStatistics}>
   <Text size="xs" c="dimmed" mb="xs">{ui.listStatistics}</Text>
   <SimpleGrid cols={{base:2,sm:4}} spacing="sm" mb="md">
    {cards.map(({label,value,icon,color})=><Paper key={label} withBorder p="sm">
     <Group gap="xs" wrap="nowrap">
      <ThemeIcon variant="light" radius="xl" color={color} visibleFrom="sm"><CrmNavIcon section={icon}/></ThemeIcon>
      <div><Text size="xs" c="dimmed">{label}</Text>
      <Text size="xl" fw={700}>{value?.toLocaleString("ru-RU")??ui.missing}</Text></div>
     </Group>
    </Paper>)}
   </SimpleGrid>
  </section>
  {returnChat&&returnChat.clientId===query.clientId&&<Button mb="sm" variant="subtle" disabled={!detail?.displayName&&!returnChat.clientName} onClick={()=>onNavigate?.("inbox",{...returnChat,clientName:detail?.displayName||returnChat.clientName,clientsReturn:window.location.pathname+window.location.search})}>{ui.returnChat}</Button>}
  <div className="clients-toolbar"><TextInput ref={searchRef} aria-label={ui.search} placeholder={ui.search} value={query.search} onChange={e=>update({search:e.currentTarget.value,page:1})}/><Select aria-label={ui.source} placeholder={ui.allSources} clearable value={query.source||null} data={(options?.sources??[]).map(value=>({value,label:ui.channels[value]??ui.unavailable}))} onChange={value=>update({source:value??"",page:1})}/><Select aria-label={ui.country} placeholder={ui.allCountries} clearable searchable value={query.country||null} data={options?.countries??[]} onChange={value=>update({country:value??"",page:1})}/><Select aria-label={ui.status} placeholder={ui.allStatuses} clearable value={query.status||null} data={(options?.statuses??[]).map(value=>({value,label:ui.statuses[value]??ui.unavailable}))} onChange={value=>update({status:value??"",page:1})}/><Button variant="default" aria-expanded={moreFilters} onClick={()=>setMoreFilters(!moreFilters)}>{ui.filters}</Button></div>
  {(moreFilters||query.period)&&<Group mb="md" align="flex-end"><TextInput type="month" label={ui.period} value={query.period} onChange={e=>update({period:e.currentTarget.value,page:1})}/><Button variant="subtle" onClick={()=>update({page:1,search:"",source:"",country:"",status:"",period:""})}>{ui.clear}</Button></Group>}
  <div className="clients-columns"><ClientsTable data={state.list} error={state.listError} retry={state.refresh} query={query} onQuery={update} onSelect={select} checked={checked} onCheck={onCheck} onOrder={onOrder} onArchive={canArchive?openArchive:undefined}/>{desktop&&<aside className="clients-detail-panel">{detailContent}</aside>}</div>
  <Drawer opened={!desktop&&!!query.clientId} onClose={closeDetail} position="right" size={mobile?"100%":600} title={ui.client} closeButtonProps={{"aria-label":ui.back,disabled:!!flow||overlay}} classNames={{content:"clients-drawer",header:"clients-drawer-header",body:"clients-drawer-body"}} closeOnEscape={!flow&&!overlay} closeOnClickOutside={!flow&&!overlay} trapFocus={!flow&&!overlay} returnFocus>{!desktop&&detailContent}</Drawer>
  {archiveTarget&&<Modal opened centered returnFocus={false} onClose={closeArchive} title={ui.archiveClient}
   closeOnEscape={!archiving} closeOnClickOutside={!archiving} closeButtonProps={{disabled:archiving,"aria-label":ui.close}}>
   <Text fw={600} mb="xs">{archiveTarget.displayName}</Text>
   <Text size="sm" mb="md">{ui.archiveWarning}</Text>
   {archiveError&&<Alert color="red" role="alert" mb="md">{archiveError}</Alert>}
   <Group justify="flex-end">
    <Button data-autofocus variant="default" disabled={archiving} onClick={closeArchive}>{ui.cancel}</Button>
    <Button color="red.8" loading={archiving} onClick={archiveClient}>{ui.archiveConfirm}</Button>
   </Group>
  </Modal>}
  {creating&&<CreateClient onClose={()=>{setCreating(false);createClientTriggerRef.current?.focus();}} onCreated={client=>{setCreating(false);update({clientId:client.id,tab:"overview"},true);state.refresh();createClientTriggerRef.current?.focus();}}/>}
  {duplicates&&<Duplicates onClose={()=>{setDuplicates(false);duplicateTriggerRef.current?.focus();}} onSelect={rows=>{setDuplicates(false);setChecked(new Map(rows.map(row=>[row.id,row])));setMergeRows(rows);}}/>}
  {mergeRows&&<MergeClients clients={mergeRows} onClose={()=>{setMergeRows(undefined);mergeTriggerRef.current?.focus();}} onMerged={id=>{setMergeRows(undefined);setChecked(new Map());update({clientId:id,tab:"overview"},true);state.refresh();mergeTriggerRef.current?.focus();}}/>}
  {flow==="athlete"&&detail&&<AddAthlete clientId={detail.id} request={clientRequest} returnFocusRef={addAthleteTriggerRef} close={()=>setFlow(undefined)} done={saved}/>}
  {flow==="review-measurements"&&detail&&<Modal opened onClose={()=>setFlow(undefined)} title={ui.staleMeasurements} centered><Text size="sm" mb="md">{ui.staleWarning}</Text><Group justify="flex-end"><Button variant="default" onClick={()=>setFlow("measure")}>{ui.measure}</Button><Button variant="default" onClick={()=>{setAllowStale(true);setFlow("order");}}>{ui.verifiedStale}</Button><Button onClick={()=>{setAllowStale(false);setFlow("order");}}>{ui.withoutStale}</Button></Group></Modal>}
  {flow==="order"&&detail&&<OrderPanel client={clientForNewOrder(detail,allowStale)} initialAthleteId={initialAthleteId} request={clientRequest} onClose={()=>setFlow(undefined)} onSaved={saved}/>}
  {flow==="measure"&&detail&&<MeasurementPanel client={detail} request={clientRequest} onClose={()=>setFlow(undefined)} onSaved={saved}/>}
 </main>;
}

export function AddAthlete({
  clientId,
  close,
  done,
  request,
  returnFocusRef,
}: {
  clientId: string;
  close: () => void;
  done: () => void;
  request: (p: string, i?: RequestInit) => Promise<any>;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeRef = useRef(close),
    savingRef = useRef(saving);
  closeRef.current = close;
  savingRef.current = saving;
  useEffect(() => {
    if (restoreTimerRef.current !== undefined) clearTimeout(restoreTimerRef.current);
    firstNameRef.current?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape" && !savingRef.current) closeRef.current();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        ),
      ];
      if (!controls.length) return;
      const first = controls[0]!,
        last = controls[controls.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      // The containing Mantine Drawer reactivates its focus trap on close.
      // Restore the initiating control after that commit, not during cleanup.
      const trigger = returnFocusRef.current;
      restoreTimerRef.current = setTimeout(() => {
        if (trigger?.isConnected && returnFocusRef.current === trigger) returnFocusRef.current?.focus();
      }, 10);
    };
  }, [returnFocusRef]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget),
      discipline = String(f.get("discipline") || ""),
      body: { firstName: string; lastName?: string; discipline?: string } = {
        firstName: String(f.get("firstName") || "").trim(),
        lastName: String(f.get("lastName") || "").trim() || undefined,
      };
    if (discipline) body.discipline = discipline;
    try {
      await request(`/clients/${clientId}/athletes`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      done();
    } catch (x) {
      setError(x instanceof Error ? x.message : clientAthleteUi.saveError);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal opened onClose={close} title={clientAthleteUi.title} centered
      closeOnEscape={!saving} closeOnClickOutside={!saving}
      closeButtonProps={{disabled:saving,"aria-label":clientAthleteUi.close}}>
      <form
        ref={dialogRef}
        onSubmit={submit}
      >
        <CrmTextInput data-autofocus ref={firstNameRef} label={clientAthleteUi.firstName} name="firstName" required />
        <CrmTextInput label={clientAthleteUi.lastName} name="lastName" />
        <CrmNativeSelect
          name="discipline"
          label={clientAthleteUi.discipline}
          data={[
            { value: "", label: clientAthleteUi.disciplineNotSet },
            { value: "RHYTHMIC_GYMNASTICS", label: clientAthleteUi.rhythmicGymnastics },
            { value: "ACROBATIC_GYMNASTICS", label: clientAthleteUi.acrobaticGymnastics },
            { value: "FIGURE_SKATING", label: clientAthleteUi.figureSkating },
            { value: "AEROBIC_GYMNASTICS", label: clientAthleteUi.aerobicGymnastics },
            { value: "BATON_TWIRLING_MAJORETTE", label: clientAthleteUi.batonTwirling },
            { value: "OTHER", label: clientAthleteUi.other },
          ]}
        />
        {error && (
          <div className="phase2-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <CrmButton type="button" tone="secondary" onClick={close} disabled={saving}>
            {clientAthleteUi.cancel}
          </CrmButton>
          <CrmButton type="submit" disabled={saving}>
            {saving ? clientAthleteUi.saving : clientAthleteUi.save}
          </CrmButton>
        </footer>
      </form>
    </Modal>
  );
}
