"use client";
import { orderSourceUi as sourceUi } from "../../lib/i18n";
import { sourceLabel } from "../../lib/order-source";

import "../../app/designs-instances.css";
import { HistoricalInstance } from "./historical-instance";
import { DesignsInstancesTab, CompositionEditor } from "./designs-instances";
import { OrderDiscountEditor } from "./order-discount-editor";
import { orderDiscountUi } from "../../lib/i18n";
import { InstanceMeasurementDrawer } from "./instance-measurement-drawer";
import { MeasurementUsage, MeasurementArchiveAction, type MeasurementUsageRow } from "./measurement-usage";
import { designsInstancesUi as designsUi } from "../../lib/i18n";
import { Select } from "@mantine/core";

import { moneyLabel } from "../../lib/finance-report";
import { orderSettlement } from "../../lib/order-settlement.mjs";
import { dataEvidenceUi } from "../../lib/i18n";

import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Badge, Menu, Modal, UnstyledButton } from "@mantine/core";
import { orderFormUi, ordersDashboardUi as ui, overviewContextUi } from "../../lib/i18n";
import { orderLabel } from "../../lib/orders-i18n";
import { orderInitialTab, shipmentContextId } from "../../lib/order-context";
import { orderTimelinePresentation, productionStatusForDisplay } from "../../lib/production-view";
import { repairMojibake } from "../../lib/text-encoding.mjs";
import { CrmAlert } from "../crm/alert";
import { CrmActionIcon, CrmButton, CrmCheckbox, CrmNativeSelect, CrmTextInput, CrmTextarea } from "../crm/settings-controls";
import { CrmStatusBadge } from "../crm/status-badge";
import { CrmTabList } from "../crm/tab-list";
import { measurementFieldLabels, MeasurementPanel } from "../measurement-panel";
import { basicMeasurementNumbers, additionalMeasurementNumbers } from "../measurement-definition";
import { OrderExpenseEditor } from "./order-expense-editor";
import { InvoiceEditor } from "../invoice-editor";
import type { Order } from "../orders-workspace";

export type Athlete = NonNullable<Order["athlete"]> & {
  updatedAt?: string; archivedAt?: string | null;
  measurements?: Array<NonNullable<Order["measurement"]> & { notes?: string; archivedAt?: string | null }>;
};

export type OrderItemInstanceView = {
  id: string;
  updatedAt: string;
  ordinal: number;
  standardHeight?: number | null;
  archivedAt?: string | null;
  productionStatus: string;
  athlete?: Athlete | null;
  measurement?: (NonNullable<Order["measurement"]> & {archivedAt?: string | null}) | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  orderShipment?: { id: string; status: string; trackingNumber?: string | null } | null;
};

export type ExpandedOrderItem = Omit<Order["items"][number], "instances"> & {
  persistedItemId?: string;
  archivedAt?: string | null;
  discipline?: string | null;
  notes?: string | null;
  athlete?: Athlete;
  measurementHistory?: Array<NonNullable<Order["measurement"]> & { notes?: string }>;
  instances?: OrderItemInstanceView[];
};

type OrderFileView = { id: string; name: string; path: string; mimeType: string; sizeBytes: number; createdAt: string };
type OrderExpenseView = { id: string; amountMinor: number; currency: string; incurredAt: string; notes?: string | null; category: { id: string; name: string } };
export type OrderShipmentView = {
  id: string;
  updatedAt: string;
  carrier: string;
  status: string;
  trackingNumber?: string | null;
  customerChargeMinor: number;
  atelierCostMinor: number;
  currency: string;
  isPrimary: boolean;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  serviceName?: string | null;
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  instances: Array<{ id: string; ordinal: number; orderItemId: string }>;
  atelierExpense?: OrderExpenseView | null;
};

export type ExpandedOrderView = Omit<Order, "items" | "client" | "activities"> & {
  client: Order["client"] & {
    updatedAt?: string;
    athletes?: Athlete[];
    preferences?: Record<string, unknown> | null;
    files?: OrderFileView[];
    orders?: Array<{ id: string; number: string; createdAt: string; priceMinor: number; currency: string; salesStatus: string; productionStatus: string; shippingStatus: string; modelImagePath?: string | null; externalImageUrl?: string | null }>;
  };
  compositionManaged?: boolean;
  responsibleManager?: { id: string; displayName: string } | null;
  paymentHistory?: Array<Order["payments"][number] & { voidedAt?: string; voidReason?: string; canVoid?: boolean; isImported?: boolean }>;
  updatedAt?: string;
  taxMinor?: number;
  giftWrapMinor?: number;
  measurementHistory?: Array<NonNullable<Order["measurement"] & { notes?: string }>>;
  items: ExpandedOrderItem[];
  orderShipments?: OrderShipmentView[];
  expenses?: OrderExpenseView[];
  activities: Array<Order["activities"][number] & { actor?: { id: string; displayName: string } | null }>;
  tags?: Array<{ id: string; label: string; color?: string }>;
  notesStructured?: Array<{
    id: string;
    category: string;
    visibility: string;
    title: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    author?: { displayName: string } | null;
  }>;
};

export type OrderNoteInput = { category: string; visibility: string; title: string; body: string };
export type OrderShipmentInput = {
  carrier: string;
  trackingNumber: string | null;
  customerChargeMinor: number;
  atelierCostMinor: number;
  currency: string;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  weightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  instanceIds: string[];
  expectedUpdatedAt?: string;
};
export type OrderItemInstanceInput = { athleteId?: string | null; measurementId?: string | null; productionStatus?: string; expectedUpdatedAt: string };
type StructuredOrderNote = NonNullable<ExpandedOrderView["notesStructured"]>[number];
type MeasurementAssignment = { id: string; item: ExpandedOrderItem; instance?: OrderItemInstanceView; measurement?: NonNullable<Order["measurement"]> };

type TabCallbacks = {
  measurementActions?: { request: (path: string, init?: RequestInit) => Promise<any>; onSaved: () => Promise<void> };
  financeActions?: { request: (path: string, init?: RequestInit) => Promise<any>; onSaved: () => Promise<void> };
  compositionActions?: { request: (path: string, init?: RequestInit) => Promise<any>; onSaved: () => Promise<void> };
  onVoidPayment?: (paymentId: string, reason: string, expectedOrderUpdatedAt: string) => Promise<void>;
  onOpenOrder?: (id:string)=>void;
  expenseActions?: { request: (path:string,init?:RequestInit)=>Promise<any>;onSaved:()=>Promise<void> };
  onClient: () => void;
  onEditClient: () => void;
  onFinance?: () => void;
  onPayment: () => void;
  onProduction: () => void;
  onDelivery: () => void;
  onDeliveryContact: () => void;
  onMeasurements: (itemId?: string) => void;
  onAddAthlete?: () => void;
  addAthleteButtonRef: RefObject<HTMLButtonElement | null>;
  onBindMeasurement: (itemId: string, measurementId: string, expectedMeasurementId: string | null) => Promise<void>;
  onCurrency: () => void;
  onCustomerWishes: () => void;
  onManagerComment: () => void;
  onEdit: () => void;
  onAddDesign: () => void;
  onEditItem: (itemId: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  onImage: (itemId: string | undefined, expectedModelImagePath: string | null, file: File) => Promise<void>;
  onProductionStatus: (value: string) => void;
  onCreateNote: (input: OrderNoteInput) => Promise<void>;
  onUpdateNote: (noteId: string, input: OrderNoteInput & { expectedUpdatedAt: string }) => Promise<void>;
  onArchiveNote?: (noteId: string) => Promise<void>;
  onCreateShipment?: (input: OrderShipmentInput) => Promise<void>;
  onUpdateShipment?: (shipmentId: string, input: OrderShipmentInput) => Promise<void>;
  onUpdateInstance: (instanceId: string, input: OrderItemInstanceInput) => Promise<void>;
  onUpdateClientPreferences: (preferences: Record<string, unknown>) => Promise<void>;
  onUploadClientFile: (file: File) => Promise<void>;
  statusPending: boolean;
};

type Props = { order: ExpandedOrderView } & TabCallbacks;

const INSTANCE_PRODUCTION_STATUSES = ["NOT_SCHEDULED", "SCHEDULED", "SEWING", "READY", "ON_HOLD", "CANCELLED"];
const NON_PRODUCTION_ORDER_TYPES = new Set(["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);

export function OrderExpandedTabs(props: Props) {
  const { order } = props;
  const [activeTab, setActiveTab] = useState("details");
  const [financeDesignEditor,setFinanceDesignEditor]=useState<{action:'ADD'|'EDIT';itemId?:string}>();
  const [historyInstanceId,setHistoryInstanceId] = useState<string>();
  const [focusInstanceId,setFocusInstanceId] = useState<string>();
  const [focusAthleteId,setFocusAthleteId] = useState<string>();
  const [targetShipmentId, setTargetShipmentId] = useState<string>();
  useEffect(() => {
    const readContext = () => {
      const params = new URLSearchParams(window.location.search);
      const ownContext = params.get("orderId") === order.id;
      setActiveTab(ownContext && ["designs","measurements"].includes(params.get("tab") ?? "") ? params.get("tab")! : orderInitialTab(window.location.search, order.id));
      setHistoryInstanceId(ownContext ? params.get("historyInstanceId") ?? undefined : undefined);
      setFocusInstanceId(ownContext ? params.get("instanceId") ?? undefined : undefined);
      setFocusAthleteId(ownContext ? params.get("athleteId") ?? undefined : undefined);
      setTargetShipmentId(shipmentContextId(window.location.search, order.id));
    };
    readContext();
    window.addEventListener("popstate", readContext);
    return () => window.removeEventListener("popstate", readContext);
  }, [order.id]);
  const closeHistorical = () => {
    setHistoryInstanceId(undefined);
    const url=new URL(window.location.href);url.searchParams.delete("historyInstanceId");
    window.history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
  };
  const openInstance = (row:MeasurementUsageRow) => {
    if(row.archived){
      const url=new URL(window.location.href);url.searchParams.set("section","orders");url.searchParams.set("orderId",order.id);url.searchParams.set("tab","designs");url.searchParams.set("historyInstanceId",row.instanceId);url.searchParams.delete("instanceId");
      window.history.pushState(null,"",`${url.pathname}${url.search}${url.hash}`);
      setHistoryInstanceId(row.instanceId);setFocusInstanceId(undefined);setActiveTab("designs");return;
    }
    setHistoryInstanceId(undefined);
    const url=new URL(window.location.href);url.searchParams.delete("historyInstanceId");url.searchParams.set("section","orders");url.searchParams.set("orderId",row.orderId);url.searchParams.set("tab","designs");url.searchParams.set("instanceId",row.instanceId);
    window.history.pushState(null,"",`${url.pathname}${url.search}${url.hash}`);
    if(row.orderId===order.id){setActiveTab("designs");setFocusInstanceId(row.instanceId);}else {
      // Usage can refer outside the current Orders filter. Native explicit context avoids
      // onOpenOrder rejecting a valid client record through the current list cohort.
      for(const key of ["source","period","quick","status","search","page","clientId"])url.searchParams.delete(key);
      window.location.assign(url.toString());
    }
  };
  const openMeasurements = (instance:OrderItemInstanceView) => {setFocusInstanceId(instance.id);setFocusAthleteId(instance.athlete?.id);setActiveTab("measurements");};
  const items = expandedOrderItems(order);
  const tabPanelId = `order-tab-panel-${order.id}`;
  const tabs = [
    { key: "details", label: ui.tabs.details, icon: "details" },
    { key: "designs", label: `${ui.tabs.designs} (${items.length})`, icon: "designs" },
    { key: "measurements", label: ui.tabs.measurements, icon: "measurements" },
    { key: "client", label: ui.tabs.client, icon: "client" },
    { key: "finance", label: ui.tabs.finance, icon: "finance" },
    { key: "production", label: ui.tabs.production, icon: "production" },
    { key: "delivery", label: ui.tabs.delivery, icon: "delivery" },
    { key: "notes", label: ui.tabs.notes, icon: "notes" },
    { key: "history", label: ui.tabs.history, icon: "history" },
  ];

  return <>
    <CrmTabList
      value={activeTab}
      onChange={setActiveTab}
      className="orders-order-tabs"
      ariaLabel={ui.orderDetails}
      tabs={tabs.map((tab) => ({
        value: tab.key,
        label: tab.label,
        panelId: tabPanelId,
        tabId: `order-tab-${order.id}-${tab.key}`,
        icon: <TabIcon name={tab.icon} />,
      }))}
    />
    <section id={tabPanelId} aria-labelledby={`order-tab-${order.id}-${activeTab}`} className={`orders-order-tab-panel orders-order-tab-${activeTab}`} role="tabpanel">
      {activeTab === "details" && <OrderDetailsTab {...props} items={items} />}
      {activeTab === "designs" && historyInstanceId && <HistoricalInstance key={`${order.id}-${historyInstanceId}`} contextOrderId={order.id} instanceId={historyInstanceId} bridge={props.measurementActions??props.financeActions} onClose={closeHistorical} renderMeasurements={measurement=><MeasurementGrid measurement={measurement}/>}/>}
      {activeTab === "designs" && <DesignsInstancesTab order={order} items={items} bridge={props.financeActions} compositionBridge={props.compositionActions} focusInstanceId={focusInstanceId} onMeasurements={openMeasurements} />}
      {activeTab === "measurements" && <OrderMeasurementsTab {...props} items={items} focusAthleteId={focusAthleteId} focusInstanceId={focusInstanceId} onOpenInstance={openInstance} />}
      {activeTab === "client" && <OrderClientTab {...props} items={items} />}
      {activeTab === "finance" && <OrderFinanceTab {...props} items={items} onAddDesign={()=>setFinanceDesignEditor({action:'ADD'})} onEditItem={itemId=>setFinanceDesignEditor({action:'EDIT',itemId})} />}
      {activeTab === "production" && <OrderProductionTab {...props} items={items} />}
      {activeTab === "delivery" && <OrderDeliveryTab {...props} items={items} targetShipmentId={targetShipmentId} />}
      {activeTab === "notes" && <OrderNotesTab {...props} />}
      {activeTab === "history" && <OrderHistoryTab order={order} />}
    </section>
    {financeDesignEditor&&props.financeActions&&<CompositionEditor key={`${financeDesignEditor.action}-${financeDesignEditor.itemId??'new'}`} order={order} action={financeDesignEditor.action} item={items.find(item=>item.id===financeDesignEditor.itemId)} bridge={props.compositionActions??props.financeActions} onClose={()=>setFinanceDesignEditor(undefined)}/>}
  </>;
}

function OrderDetailsTab({ order, items, onClient, onEdit, onDelivery, onDeliveryContact, onCustomerWishes, onUploadFile }: Props & { items: ExpandedOrderItem[] }) {
  const timeline = orderTimelinePresentation(order);
  const paidMinor = paid(order);
  const recent = order.activities.slice(0, 4);
  return <div className="orders-tab-details-approved">
    <TabCard title={ui.primaryInformation} action={<CrmButton tone="secondary" size="compact-xs" onClick={onEdit}>{ui.edit}</CrmButton>}>
      <FieldGrid>
        <Field label={ui.orderNumber} value={order.number} /><Field label={sourceUi.filter} value={sourceLabel(order.orderSource)} />
        <Field label={ui.orderTypeName} value={orderTypeLabel(order.type)} />
        <Field label={ui.createdAt} value={formatDate(order.createdAt)} />
        <Field label={ui.source} value={orderLabel("source", order.client.source)} />
        <Field label={ui.manager} value={order.responsibleManager?.displayName || ui.notSpecified} />
        <Field label={ui.statusPrefix} value={<CrmStatusBadge domain="sales" status={order.salesStatus} />} />
        <Field label={ui.currency} value={order.currency} />
        <Field label={ui.total} value={money(order.priceMinor, order.currency)} />
        <Field label={ui.paid} value={money(paidMinor, order.currency)} tone="success" />
        <Field label={ui.balance} value={money(balance(order), order.currency)} tone={balance(order) ? "danger" : "success"} />
      </FieldGrid>
    </TabCard>
    <TabCard title={ui.clientDetails} action={<CrmButton tone="secondary" size="compact-xs" onClick={onClient}>{ui.openClient}</CrmButton>}>
      <ClientIdentity order={order} />
      <FieldGrid single>
        <Field label={ui.phone} value={order.client.phone || ui.notSpecified} />
        <Field label={ui.email} value={order.client.email || ui.notSpecified} />
        <Field label={ui.language} value={order.client.language || ui.notSpecified} />
      </FieldGrid>
    </TabCard>
    <TabCard title={ui.shippingDetails} action={<CrmButton tone="secondary" size="compact-xs" onClick={onDelivery}>{ui.edit}</CrmButton>}>
      <FieldGrid single>
        <EditableField label={ui.recipient} value={deliveryRecipient(order)} onClick={onDelivery} />
        <EditableField label={ui.address} value={deliveryPlace(order)} onClick={onDelivery} />
        <EditableField label={ui.phone} value={order.deliveryRecipientPhone || order.client.phone || ui.notSpecified} onClick={onDeliveryContact} />
        <Field label={ui.method} value={shipmentMethod(order)} />
        <Field label={ui.tracking} value={trackingNumber(order) || ui.notSpecified} />
      </FieldGrid>
    </TabCard>
    <TabCard title={ui.shortNotes} action={<CrmButton tone="secondary" size="compact-xs" onClick={onCustomerWishes}>{ui.edit}</CrmButton>}>
      <p className="orders-tab-note">{order.buyerComment || order.notes || ui.notSpecified}</p>
      <h4 className="orders-approved-subtitle">{ui.tags}</h4>
      <div className="orders-approved-tags">
        {(order.tags ?? []).map((tag) => <span key={tag.id}>{tag.label}</span>)}
        {!order.tags?.length && <EmptyState text={ui.tagsUnavailable} compact />}
      </div>
    </TabCard>
    <TabCard className="orders-tab-span-4" title={ui.orderComposition}>
      <div className="orders-composition-list">{items.map((item, index) => <div key={item.id}><span>{index + 1}</span><ItemThumb item={item} /><strong>{item.name}</strong><small>{item.quantity} {ui.pieces}</small><b>{money(item.priceMinor * item.quantity, order.currency)}</b></div>)}</div>
    </TabCard>
    <TabCard className="orders-tab-span-4" title={ui.stageStatuses}>
      <div className="orders-stage-list"><Stage icon="finance" label={ui.payment} value={orderLabel("payment", order.paymentStatus)} /><Stage icon="production" label={ui.tabs.production} value={timeline.productionCompleted ? ui.productionFulfilled : orderLabel("production", timeline.productionStatus)} /><Stage icon="delivery" label={ui.tabs.delivery} value={timeline.partial ? `${ui.shippingPartial}${["LOST","RETURNED"].includes(timeline.shippingStatus) ? ` · ${orderLabel("shipping",timeline.shippingStatus)}` : ""}` : timeline.shippingStatus === "SHIPPED" ? ui.shippingSent : orderLabel("shipping", timeline.shippingStatus)} /></div>
    </TabCard>
    <OrderFilesCard className="orders-tab-span-4" order={order} onUpload={onUploadFile} />
    <TabCard className="orders-tab-span-full" title={ui.latestActions}>
      {recent.length ? <ActivityList activities={recent} /> : <EmptyState text={ui.noHistory} />}
    </TabCard>
  </div>;
}

function OrderMeasurementsTab({ order, items, onMeasurements, onAddAthlete, addAthleteButtonRef, onBindMeasurement, measurementActions, financeActions, focusAthleteId, focusInstanceId, onOpenInstance }: Props & { items: ExpandedOrderItem[]; focusAthleteId?:string; focusInstanceId?:string; onOpenInstance:(row:MeasurementUsageRow)=>void }) {
  const athletes = [...new Map([...uniqueAthletes(order, items), ...(order.client.athletes ?? [])].map((athlete) => [athlete.id, athlete])).values()];
  const [scope,setScope]=useState<string | null>("client");
  const [drawerInstance,setDrawerInstance]=useState<OrderItemInstanceView>();
  const [selectedAthleteId, setSelectedAthleteId] = useState(focusAthleteId??athletes[0]?.id);
  useEffect(()=>{if(focusAthleteId)setSelectedAthleteId(focusAthleteId);},[focusAthleteId]);
  const assignedIds=new Set(items.flatMap(item=>item.instances?.length?item.instances.flatMap(i=>i.athlete?[i.athlete.id]:[]):item.athlete?[item.athlete.id]:[]));
  const scopedAthletes=athletes.filter(a=>(!a.archivedAt||assignedIds.has(a.id))&&(scope!=="order"||assignedIds.has(a.id)));
  const [query, setQuery] = useState("");
  const selectedAthlete = scopedAthletes.find((athlete) => athlete.id === selectedAthleteId) ?? scopedAthletes[0];
  const visibleAthletes = scopedAthletes.filter((athlete) => athleteName(athlete).toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  const assignments = items.flatMap<MeasurementAssignment>((item) => item.instances?.length
    ? item.instances.filter((instance) => instance.athlete && instance.athlete.id === selectedAthlete?.id).map((instance) => ({ id: instance.id, item, instance, measurement: ownedMeasurement(instance.measurement ?? undefined, instance.athlete ?? undefined) }))
    : item.athlete && item.athlete.id === selectedAthlete?.id ? [{ id: item.id, item, instance: undefined, measurement: ownedMeasurement(item.measurement, item.athlete) }] : []);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>(focusInstanceId??"");
  useEffect(()=>{if(focusInstanceId)setSelectedAssignmentId(focusInstanceId);},[focusInstanceId]);
  const assignment = assignments.find((entry) => entry.id === selectedAssignmentId) ?? assignments.find((entry) => entry.measurement) ?? assignments[0];
  const currentItem = assignment?.instance ? undefined : assignment?.item;
  const [chosenVersionId,setChosenVersionId]=useState<string>();
  const baseMeasurement=assignment?.measurement ?? (!assignment && selectedAthlete ? latestMeasurement(selectedAthlete) : undefined);
  const currentMeasurement:(NonNullable<Order["measurement"]>&{archivedAt?:string|null})|undefined=selectedAthlete?.measurements?.find(m=>m.id===chosenVersionId)??baseMeasurement;
  useEffect(()=>setChosenVersionId(undefined),[selectedAthlete?.id,selectedAssignmentId]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [measurementTab, setMeasurementTab] = useState("basic");
  const history = [...new Map([...(selectedAthlete?.measurements ?? []), ...assignments.flatMap((entry) => entry.measurement ? [entry.measurement] : [])].filter((entry) => entry.athleteId === selectedAthlete?.id).map((entry) => [entry.id, entry])).values()].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const chooseAssignment = (id: string) => {setChosenVersionId(undefined);setSelectedAssignmentId(id);};
  const options = currentItem ? clientMeasurementOptions(order, currentItem) : [];
  return <div className="orders-tab-measurements-approved">
    <aside className="orders-athlete-rail"><Select className="design-measurements-scope" aria-label={designsUi.athletes} value={scope} onChange={setScope} data={[{value:"client",label:designsUi.clientScope},{value:"order",label:designsUi.orderScope}]}/><header><h3>{ui.athletesInOrder}</h3><span>{athletes.length}</span></header>{onAddAthlete && <CrmButton ref={addAthleteButtonRef} tone="secondary" size="compact-xs" onClick={onAddAthlete}>{ui.addAthlete}</CrmButton>}<CrmTextInput aria-label={ui.searchAthletes} placeholder={ui.searchAthletes} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />{visibleAthletes.length ? visibleAthletes.map((athlete) => { const index = athletes.indexOf(athlete); return <button key={athlete.id} className={athlete.id === selectedAthlete?.id ? "active" : ""} onClick={() => {setChosenVersionId(undefined);setSelectedAthleteId(athlete.id);}}><b>{index + 1}</b><span><strong>{athleteName(athlete)}{athlete.archivedAt ? ` · ${designsUi.archived}` : ""}</strong><small>{latestMeasurement(athlete) ? `${ui.measurementTakenAt}: ${formatDate(latestMeasurement(athlete)!.measuredAt)}` : ui.noMeasurements}</small></span></button>; }) : <EmptyState text={scopedAthletes.length ? ui.noSearchResults : athletes.length ? designsUi.noAssignedAthletes : designsUi.noClientAthletes} />}</aside>
    <div className="orders-measurement-workspace">
      {selectedAthlete ? <>
        <header><div><span className="orders-avatar-small">{initials(athleteName(selectedAthlete))}</span><h3>{athleteName(selectedAthlete)}</h3><p>{currentMeasurement ? `${assignment ? ui.currentMeasurement : ui.profileMeasurements} · ${formatDate(currentMeasurement.measuredAt)}` : ui.noMeasurements}</p></div><div className="orders-measurement-toolbar">{measurementActions && !selectedAthlete.archivedAt && <CrmButton tone="secondary" size="compact-sm" onClick={() => setNameOpen(true)}> {ui.editAthleteName}</CrmButton>}{measurementActions && !selectedAthlete.archivedAt && (!assignment || assignment.instance) && <CrmButton tone="secondary" size="compact-sm" onClick={() => setEditorOpen(true)}>{currentMeasurement ? ui.editMeasurements : ui.addMeasurements}</CrmButton>}{!selectedAthlete.archivedAt && currentItem?.persistedItemId && <CrmButton tone="secondary" size="compact-sm" onClick={() => onMeasurements(currentItem.persistedItemId)}>{currentMeasurement ? ui.newMeasurementVersion : ui.addMeasurements}</CrmButton>}</div></header>
        {financeActions&&selectedAthlete.updatedAt&&!selectedAthlete.archivedAt&&<MeasurementArchiveAction label={designsUi.archiveAthlete} path={`/order-tabs/${order.id}/athletes/${selectedAthlete.id}/archive`} body={{expectedUpdatedAt:selectedAthlete.updatedAt}} bridge={financeActions}/>}
        {financeActions&&currentMeasurement&&!currentMeasurement.archivedAt&&!selectedAthlete.archivedAt&&<MeasurementArchiveAction label={designsUi.archiveVersion} path={`/order-tabs/${order.id}/measurements/${currentMeasurement.id}/archive`} body={{expectedArchivedAt:null}} bridge={financeActions}/>}
        {history.length>0&&<Select label={designsUi.version} value={currentMeasurement?.id??null} onChange={id=>setChosenVersionId(id??undefined)} data={history.map(m=>({value:m.id,label:`${formatDate(m.measuredAt)} · ${m.id}`}))}/>}
        {assignments.length > 1 && <CrmNativeSelect label={ui.measurementProductSelection} value={assignment?.id ?? ""} onChange={(event) => chooseAssignment(event.currentTarget.value)} data={assignments.map((entry) => ({ value: entry.id, label: `${entry.item.name} · ${entry.instance ? displayInstanceNumber(items, entry.item, entry.instance.ordinal) : ui.measurementAssignmentAtDesignLevel}` }))} />}
        {assignment?.instance&&financeActions&&<CrmButton size="compact-sm" tone="secondary" onClick={()=>setDrawerInstance(assignment.instance)}>{designsUi.assign}</CrmButton>}
        <CrmTabList value={measurementTab} onChange={setMeasurementTab} className="orders-measurement-subtabs" ariaLabel={ui.measurementSections} tabs={[{ value: "basic", label: ui.basicMeasurements }, { value: "additional", label: ui.additionalMeasurements }, { value: "photo", label: ui.measurementPhoto }, { value: "history", label: ui.measurementHistory }]} />
        {currentItem?.persistedItemId && options.length > 0 && <CrmNativeSelect aria-label={`${ui.bindMeasurement}: ${currentItem.name}`} value={currentMeasurement?.id || ""} onChange={(event) => event.target.value && void onBindMeasurement(currentItem.persistedItemId!, event.target.value, currentMeasurement?.id ?? null)} data={[{ value: "", label: ui.bindMeasurement }, ...options]} />}
        {measurementTab === "basic" || measurementTab === "additional" ? currentMeasurement ? <MeasurementGrid measurement={currentMeasurement} numbers={measurementTab === "basic" ? basicMeasurementNumbers : additionalMeasurementNumbers} /> : <EmptyState text={ui.noMeasurements} /> : measurementTab === "photo" ? <EmptyState text={ui.noAthletePhoto} /> : history.length ? <ol className="orders-measurement-history-compact">{history.map((measurement, index) => <li key={measurement.id}><div><strong>{formatDate(measurement.measuredAt)}</strong><span>{measurement.id === currentMeasurement?.id ? assignment ? ui.measurementUsedInSelection : ui.currentVersion : `${ui.version} ${history.length - index}`}</span></div><p>{basicMeasurementNumbers.map(number => <span key={number} title={measurementFieldLabels[number - 1]}>№{number}: <strong>{measurement.values?.[`m${number}`] == null ? "—" : `${formatCm(measurement.values[`m${number}`]!)} см`}</strong></span>)}</p></li>)}</ol> : <EmptyState text={ui.noMeasurementHistory} />}
      </> : <EmptyState text={ui.noAthletesInOrder} />}
    </div>
    <aside className="orders-measurement-side">
      <TabCard title={ui.usedInProducts}><MeasurementUsage orderId={order.id} athleteId={selectedAthlete?.id} bridge={measurementActions??financeActions} onOpen={onOpenInstance}/></TabCard>
      <TabCard title={ui.measurementHistory}>{history.length ? history.map((measurement, index) => <div className="orders-history-dot" key={measurement.id}><i /><span><strong>{formatDate(measurement.measuredAt)}</strong><small>{measurement.id === currentMeasurement?.id ? assignment ? ui.measurementUsedInSelection : ui.currentVersion : `${ui.version} ${history.length - index}`}</small></span></div>) : <EmptyState text={ui.noMeasurementHistory} />}</TabCard>
    </aside>
    <div className="orders-measurement-summary orders-tab-span-full"><SummaryMetric label={ui.totalAthletes} value={String(athletes.length)} /><SummaryMetric label={ui.measurementsReceivedCount} value={`${athletes.filter((athlete) => latestMeasurement(athlete)).length} ${ui.of} ${athletes.length}`} /><SummaryMetric label={ui.usedInProducts} value={String(items.reduce((count, item) => count + (item.instances?.length ? item.instances.filter((instance) => instance.athlete).length : item.athlete ? 1 : 0), 0))} /><SummaryMetric label={ui.latestUpdate} value={latestClientMeasurementDate(athletes) || ui.notSpecified} /></div>
    {drawerInstance&&financeActions&&<InstanceMeasurementDrawer key={drawerInstance.id} order={order} items={items} instance={drawerInstance} bridge={financeActions} onClose={()=>setDrawerInstance(undefined)}/>}
    {nameOpen && selectedAthlete && measurementActions && <AthleteNameEditor athlete={selectedAthlete} clientId={order.client.id} actions={measurementActions} onClose={() => setNameOpen(false)} />}
    {editorOpen && selectedAthlete && measurementActions && <OrderMeasurementEditor order={order} athlete={selectedAthlete} assignment={assignment} measurement={currentMeasurement} actions={measurementActions} onClose={() => setEditorOpen(false)} />}
  </div>;
}

function OrderMeasurementEditor({ order, athlete, assignment, measurement, actions, onClose }: { order: ExpandedOrderView; athlete: Athlete; assignment?: MeasurementAssignment; measurement?: NonNullable<Order["measurement"]>; actions: NonNullable<TabCallbacks["measurementActions"]>; onClose: () => void }) {
  // Freeze the selected copy source separately from the current assigned snapshot CAS.
  const [original] = useState(() => ({ orderId: order.id, client: { id: order.client.id, displayName: order.client.displayName, athletes: [athlete] }, instance: assignment?.instance, measurement }));
  return <MeasurementPanel client={original.client} request={(path, init) => original.instance && init?.method === "POST" && path.endsWith("/measurements") ? actions.request(`/order-tabs/${original.orderId}/instances/${original.instance.id}/measurement`, { ...init, body: JSON.stringify({ ...JSON.parse(String(init.body)), expectedMeasurementId: original.instance.measurement?.id ?? null, expectedUpdatedAt: original.instance.updatedAt }) }) : actions.request(path, init)} initialValues={original.measurement?.values} title={original.measurement ? ui.editMeasurements : ui.addMeasurements} onClose={onClose} onSaved={async () => { await actions.onSaved(); onClose(); }} />;
}

function AthleteNameEditor({ athlete, clientId, actions, onClose }: { athlete: Athlete; clientId: string; actions: NonNullable<TabCallbacks["measurementActions"]>; onClose: () => void }) {
  const [original] = useState(() => ({ athlete, clientId }));
  const [firstName, setFirstName] = useState(athlete.firstName);
  const [lastName, setLastName] = useState(athlete.lastName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal opened aria-label={ui.editAthleteName} onClose={() => !busy && onClose()} title={ui.editAthleteName} centered closeOnEscape={!busy} closeOnClickOutside={!busy}><form onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await actions.request(`/clients/${original.clientId}/athletes/${original.athlete.id}`, { method: "PATCH", body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() || null, expectedFirstName: original.athlete.firstName, expectedLastName: original.athlete.lastName ?? null }) }); await actions.onSaved(); onClose(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }}><CrmTextInput label={ui.athleteFirstName} value={firstName} required data-autofocus onChange={(event) => setFirstName(event.currentTarget.value)} /><CrmTextInput label={ui.athleteLastName} value={lastName} onChange={(event) => setLastName(event.currentTarget.value)} />{error && <CrmAlert>{error}</CrmAlert>}<div className="orders-measurement-toolbar"><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.save}</CrmButton></div></form></Modal>;
}

function OrderClientTab({ onOpenOrder, order, items, onClient, onEditClient, onMeasurements, onDelivery, onUpdateClientPreferences, onUploadClientFile }: Props & { items: ExpandedOrderItem[] }) {
  const athletes = order.client.athletes?.length ? order.client.athletes : uniqueAthletes(order, items);
  const previousOrders = (order.client.orders ?? []).filter((candidate) => candidate.id !== order.id);
  const clientOrders = order.client.orders ?? [];
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const clientFileInput = useRef<HTMLInputElement>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  async function selectClientFile(file?: File) { if (!file || fileBusy) return; setFileBusy(true); setFileError(""); try { await onUploadClientFile(file); } catch (reason) { setFileError((reason as Error).message); } finally { setFileBusy(false); if (clientFileInput.current) clientFileInput.current.value = ""; } }
  return <div className="orders-tab-client-approved">
    <TabCard className="orders-client-profile" title={ui.clientInformation} action={<CrmButton tone="secondary" size="compact-xs" onClick={onEditClient}>{ui.edit}</CrmButton>}>
      <ClientIdentity order={order} large />
      <FieldGrid single><Field label={ui.phone} value={order.client.phone || ui.notSpecified} /><Field label={ui.email} value={order.client.email || ui.notSpecified} /><Field label={ui.source} value={orderLabel("source", order.client.source)} /><Field label={ui.language} value={order.client.language || ui.notSpecified} /><Field label={ui.clientSince} value={clientOrders.length ? formatDate([...clientOrders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!.createdAt) : ui.notSpecified} /><Field label={ui.totalOrders} value={String(clientOrders.length || 1)} /><Field label={ui.totalPurchases} value={money(clientOrders.reduce((sum, candidate) => candidate.currency === order.currency ? sum + candidate.priceMinor : sum, 0) || order.priceMinor, order.currency)} /></FieldGrid>
      <CrmButton tone="secondary" size="compact-sm" onClick={onClient}>{ui.openClient} →</CrmButton>
    </TabCard>
    <div className="orders-client-main">
      <TabCard title={`${ui.athletes} (${athletes.length})`}>
        {athletes.length ? athletes.map((athlete) => { const item = items.find((candidate) => candidate.athlete?.id === athlete.id); const measurement = latestMeasurement(athlete) ?? item?.measurement; return <article className="orders-client-athlete" key={athlete.id}><span className="orders-avatar-small">{initials(athleteName(athlete))}</span><div><strong>{athleteName(athlete)}</strong><small>{measurement ? `${ui.measurementTakenAt}: ${formatDate(measurement.measuredAt)}` : ui.noMeasurements}</small></div>{item?.persistedItemId && <CrmButton tone="secondary" size="compact-xs" onClick={() => onMeasurements(item.persistedItemId)}>{ui.openMeasurements}</CrmButton>}</article>; }) : <EmptyState text={ui.noAthletesInOrder} />}
      </TabCard>
      <TabCard title={`${ui.previousOrders} (${previousOrders.length})`}>{previousOrders.length ? <div className="orders-previous-orders">{previousOrders.slice(0, 5).map((candidate) => <UnstyledButton className="orders-previous-order" key={candidate.id} onClick={()=>onOpenOrder?.(candidate.id)} aria-label={`${ui.orderDetails} ${candidate.number}`}><span className="orders-order-mini-image">{candidate.modelImagePath || candidate.externalImageUrl ? <img src={candidate.modelImagePath ? `/api/orders/images/${candidate.modelImagePath}` : candidate.externalImageUrl!} alt="" /> : <TabIcon name="designs" />}</span><div><strong>{candidate.number}</strong><small>{formatDate(candidate.createdAt)} · {money(candidate.priceMinor, candidate.currency)}</small></div><CrmStatusBadge domain="sales" status={candidate.salesStatus} /></UnstyledButton>)}</div> : <EmptyState text={ui.noPreviousOrders} />}</TabCard>
    </div>
    <aside className="orders-client-side">
      <TabCard title={ui.recipientsAndAddress} action={<CrmButton tone="secondary" size="compact-xs" onClick={onDelivery}>{ui.edit}</CrmButton>}><FieldGrid single><Field label={ui.recipient} value={deliveryRecipient(order)} /><Field label={ui.address} value={deliveryPlace(order)} /><Field label={ui.phone} value={order.deliveryRecipientPhone || order.client.phone || ui.notSpecified} /></FieldGrid></TabCard>
      <TabCard title={ui.clientPreferences} action={<CrmButton tone="secondary" size="compact-xs" onClick={() => setPreferencesOpen(true)}>{ui.edit}</CrmButton>}>{preferenceEntries(order.client.preferences).length ? <div className="orders-client-preferences">{preferenceEntries(order.client.preferences).map(([label, value]) => <Field key={label} label={label} value={value} />)}</div> : <EmptyState text={ui.clientPreferencesUnavailable} />}</TabCard>
      <TabCard title={ui.clientFiles} action={<><input ref={clientFileInput} hidden type="file" onChange={(event) => void selectClientFile(event.currentTarget.files?.[0])} /><CrmButton tone="secondary" size="compact-xs" loading={fileBusy} onClick={() => clientFileInput.current?.click()}>＋ {ui.addFile}</CrmButton></>}>{order.client.files?.length ? order.client.files.map((file) => <a className="orders-client-file-link" key={file.id} href={`/api/order-tabs/client-files/${file.path}`} target="_blank" rel="noreferrer"><FileRow file={file} /></a>) : <EmptyState text={ui.noClientFiles} />}{fileError && <CrmAlert onClose={() => setFileError("")}>{fileError}</CrmAlert>}</TabCard>
    </aside>
    <Modal opened={preferencesOpen} onClose={() => setPreferencesOpen(false)} title={ui.editClientPreferences} aria-label={ui.editClientPreferences} closeButtonProps={{ "aria-label": ui.close }} centered size={560}><ClientPreferencesForm preferences={order.client.preferences} onCancel={() => setPreferencesOpen(false)} onSubmit={async (preferences) => { await onUpdateClientPreferences(preferences); setPreferencesOpen(false); }} /></Modal>
  </div>;
}

function ClientPreferencesForm({ preferences, onCancel, onSubmit }: { preferences?: Record<string, unknown> | null; onCancel: () => void; onSubmit: (preferences: Record<string, unknown>) => Promise<void> }) {
  const [value, setValue] = useState(JSON.stringify(preferences ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); let parsed: unknown; try { parsed = JSON.parse(value); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(); } catch { setError(ui.clientPreferencesInvalid); return; } setBusy(true); try { await onSubmit(parsed as Record<string, unknown>); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  return <form className="orders-client-preferences-form" onSubmit={submit}><p>{ui.clientPreferencesHint}</p><CrmTextarea data-autofocus highlighted value={value} onChange={(event) => setValue(event.currentTarget.value)} autosize minRows={8} maxRows={18} spellCheck={false} aria-label={ui.clientPreferences} />{error && <CrmAlert onClose={() => setError("")}>{error}</CrmAlert>}<footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onCancel}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.save}</CrmButton></footer></form>;
}

function OrderFinanceTab({ expenseActions, order, items, onFinance, onPayment, onCurrency, onAddDesign, onEditItem, onCreateNote, onUpdateNote, financeActions, compositionActions, onVoidPayment }: Props & { items: ExpandedOrderItem[] }) {
  const paidMinor = paid(order), percentage = paidMinor === null ? null : order.priceMinor ? Math.min(100, Math.round(paidMinor / order.priceMinor * 100)) : 0;
  const paymentHistory = order.paymentHistory ?? order.payments;
  const productsMinor = items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);
  const latestPayment = [...paymentHistory].filter(payment => !("voidedAt" in payment && payment.voidedAt)).sort((a,b) => Date.parse(b.receivedAt)-Date.parse(a.receivedAt))[0];
  const [voidTarget, setVoidTarget] = useState<{payment: NonNullable<ExpandedOrderView["paymentHistory"]>[number]; orderUpdatedAt: string}>();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [expenseOpen,setExpenseOpen]=useState(false);
  const [error, setError] = useState("");
  const paymentsRef = useRef<HTMLDivElement>(null);
  const notes = order.notesStructured?.find(note => note.category === "FINANCE" && note.title === ui.financialNotes);
  return <div className="orders-tab-finance-approved">
    {expenseOpen&&expenseActions&&<OrderExpenseEditor orderId={order.id} orderNumber={order.number} currency={order.currency} actions={expenseActions} onClose={()=>setExpenseOpen(false)} />}
    <TabCard className="orders-finance-calculation" title={ui.orderCostCalculation}>
      <div className="orders-finance-scroll"><div className="orders-finance-table"><header><span>{ui.position}</span><span>{ui.quantity}</span><span>{ui.unitPrice}</span><span>{ui.total}</span><span /></header>{items.map((item, index) => <div key={item.id}><span><b>{index + 1}</b><ItemThumb item={item} /><strong>{item.name}</strong></span><span>{item.quantity} {ui.pieces}</span><span>{money(item.priceMinor, order.currency)}</span><strong>{money(item.priceMinor * item.quantity, order.currency)}</strong><CrmActionIcon aria-label={`${ui.financeEditPosition}: ${item.name}`} onClick={() => item.persistedItemId && onEditItem(item.persistedItemId)} disabled={!item.persistedItemId}>···</CrmActionIcon></div>)}</div></div>
      <h4 className="orders-finance-subheading">{ui.financeAdditionalServices}</h4>
      {order.taxMinor ? <MoneyRow label={ui.financeTax} value={order.taxMinor} currency={order.currency} /> : null}
      {order.giftWrapMinor ? <MoneyRow label={ui.financeGiftWrap} value={order.giftWrapMinor} currency={order.currency} /> : null}
      {!order.taxMinor && !order.giftWrapMinor && <p className="orders-finance-empty-line">{ui.financeNoAdditionalServices}</p>}
      <h4 className="orders-finance-subheading">{ui.shippingPaidByClient}</h4>
      <MoneyRow label={ui.shippingPaidByClient} value={order.deliveryMinor || 0} currency={order.currency} />
      <MoneyRow label={ui.discount} value={-(order.discountMinor || 0)} currency={order.currency} tone="danger" onEdit={compositionActions ? () => setDiscountOpen(true) : undefined} />
      <CrmButton tone="secondary" size="compact-sm" onClick={onAddDesign}>＋ {ui.financeAddPosition}</CrmButton>
    </TabCard>
    <TabCard className="orders-finance-summary" title={ui.orderTotal}>
      <MoneyRow label={`${ui.products} (${itemQuantity(order)} ${ui.pieces})`} value={productsMinor} currency={order.currency} />
      <MoneyRow label={ui.financeAdditionalServices} value={(order.taxMinor || 0)+(order.giftWrapMinor || 0)} currency={order.currency} />
      <MoneyRow label={ui.shippingPaidByClient} value={order.deliveryMinor || 0} currency={order.currency} />
      <MoneyRow label={ui.discount} value={-(order.discountMinor || 0)} currency={order.currency} tone="danger" onEdit={compositionActions ? () => setDiscountOpen(true) : undefined} />
      <MoneyRow label={ui.total} value={order.priceMinor} currency={order.currency} strong />
      <MoneyRow label={ui.paid} value={paidMinor} currency={order.currency} tone="success" />
      <MoneyRow label={ui.balance} value={balance(order)} currency={order.currency} tone={balance(order) ? "danger" : "success"} />
      <div className="orders-finance-progress"><i style={{width:`${percentage ?? 0}%`}} /></div><small className="orders-finance-progress-label">{percentage === null ? dataEvidenceUi.unavailable : `${percentage}% ${ui.financePaidPercent}`}</small>
      <div className="orders-finance-currency"><small>{ui.currency}</small><strong>{order.currency}</strong><CrmButton tone="secondary" size="compact-sm" onClick={onCurrency}>{ui.changeCurrency}: {order.currency}</CrmButton></div>
    </TabCard>
    <div className="orders-finance-side">
      <TabCard title={ui.clientPayments} action={<CrmButton tone="secondary" size="compact-xs" onClick={onPayment}>＋ {ui.addPaymentPlain}</CrmButton>}>
        <div className="orders-finance-scroll" ref={paymentsRef}><div className="orders-finance-payments"><header><span>{ui.financeDate}</span><span>{ui.financeAmount}</span><span>{ui.financeMethod}</span><span>{ui.financeStatus}</span><span>{ui.financeComment}</span><span /></header>
          {paymentHistory.map(payment => { const historyPayment = payment as NonNullable<ExpandedOrderView["paymentHistory"]>[number]; return <div className={`orders-payment-row${historyPayment.voidedAt ? " is-voided" : ""}`} key={payment.id}><span>{formatDate(payment.receivedAt)}</span><b>{money(payment.amountMinor, payment.currency)}</b><span>{paymentMethodLabel(payment.method)}</span><Badge variant="light" color={historyPayment.voidedAt ? "gray" : "teal"} size="sm" title={historyPayment.voidedAt ? ui.voidedPayment : ui.paymentReceived}>{historyPayment.voidedAt ? ui.financeVoidedShort : ui.paymentReceived}</Badge><span className="orders-payment-comment" title={[historyPayment.voidReason, payment.reference, payment.notes].filter(Boolean).join(" · ")}>{historyPayment.isImported && <small title={ui.importedPaymentHint}>{ui.importedPayment}</small>}{historyPayment.voidedAt && <small>{formatDate(historyPayment.voidedAt)} · {historyPayment.voidReason}</small>}{payment.reference && <small>{payment.reference}</small>}{payment.notes && <small>{payment.notes}</small>}{!payment.reference && !payment.notes && "—"}</span><span>{onVoidPayment && historyPayment.canVoid && order.updatedAt && <Menu withinPortal position="bottom-end"><Menu.Target><CrmActionIcon aria-label={`${ui.paymentActions}: ${payment.id}`}>···</CrmActionIcon></Menu.Target><Menu.Dropdown><Menu.Item color="red" onClick={() => setVoidTarget({payment:historyPayment,orderUpdatedAt:order.updatedAt!})}>{ui.voidPayment}</Menu.Item></Menu.Dropdown></Menu>}</span></div>; })}
        </div></div>{!paymentHistory.length && <EmptyState text={ui.noPayments} />}
      </TabCard>
      <TabCard title={ui.shippingExpenses} action={expenseActions && <CrmButton tone="secondary" size="compact-xs" onClick={()=>setExpenseOpen(true)}>＋ {ui.financeAddExpense}</CrmButton>}>
        <div className="orders-finance-scroll"><div className="orders-finance-expenses"><header><span>{ui.financeDate}</span><span>{ui.method}</span><span>{ui.financeAmount}</span><span>{ui.financeStatus}</span><span>{ui.tracking}</span></header>{order.expenses?.map(expense => { const shipment=order.orderShipments?.find(entry=>entry.atelierExpense?.id===expense.id); return <div key={expense.id}><span>{formatDate(expense.incurredAt)}</span><span>{shipment ? shipmentMethodLabel(shipment) : expense.category.name}</span><b>{money(expense.amountMinor,expense.currency)}</b><span>—</span><span>{shipment?.trackingNumber || "—"}</span></div>; })}</div></div>
        {!order.expenses?.length && <EmptyState text={ui.noShippingExpenses} compact />}<small className="orders-finance-footnote">{ui.financeExpensesHint}</small>
      </TabCard>
      <TabCard title={ui.invoices} action={financeActions && <CrmButton tone="secondary" size="compact-xs" onClick={()=>setInvoiceOpen(true)}>＋ {ui.financeCreateInvoice}</CrmButton>}>
        <div className="orders-finance-scroll"><div className="orders-finance-invoices"><header><span>{ui.invoiceNumber}</span><span>{ui.financeDate}</span><span>{ui.financeAmount}</span><span>{ui.financeStatus}</span><span>{ui.financeActionsLabel}</span></header>{order.invoices.map(invoice=><div className="orders-invoice-row" key={invoice.id}><strong>{invoice.number}</strong><span>{formatDate(invoice.issueDate)}</span><b>{money(invoice.totalMinor, invoice.currency || order.currency)}</b><span>{ui.financeInvoiceStatuses[invoice.status as keyof typeof ui.financeInvoiceStatuses] || ui.notSpecified}</span><span className="orders-invoice-actions"><ActionIcon component="a" variant="subtle" href={`/api/finance/invoices/${invoice.id}/document`} target="_blank" rel="noreferrer" aria-label={`${ui.financeViewInvoice}: ${invoice.number}`}><TabIcon name="file"/></ActionIcon><ActionIcon component="a" variant="subtle" href={`/api/finance/invoices/${invoice.id}/document?download=1`} aria-label={`${ui.financeDownloadInvoice}: ${invoice.number}`}>↓</ActionIcon></span></div>)}</div></div>{!order.invoices.length && <EmptyState text={ui.noInvoices} compact />}
      </TabCard>
    </div>
    <div className="orders-finance-bottom">
      <TabCard title={ui.financialNotes}><FinancialNotesEditor note={notes} loaded={order.notesStructured !== undefined} orderId={order.id} actions={financeActions}/></TabCard>
      <TabCard title={ui.quickActions}><div className="orders-quick-action-grid"><CrmButton tone="secondary" size="compact-sm" onClick={onPayment}>{ui.addPaymentPlain}</CrmButton>{expenseActions && <CrmButton tone="secondary" size="compact-sm" onClick={()=>setExpenseOpen(true)}>{ui.financeAddExpense}</CrmButton>}{financeActions && <CrmButton tone="secondary" size="compact-sm" onClick={()=>setInvoiceOpen(true)}>{ui.financeCreateInvoice}</CrmButton>}<CrmButton tone="secondary" size="compact-sm" onClick={onCurrency}>{ui.changeCurrency}</CrmButton><CrmButton tone="secondary" size="compact-sm" onClick={()=>paymentsRef.current?.scrollIntoView({block:"center"})}>{ui.financeViewPayments}</CrmButton>{onFinance && <CrmButton tone="secondary" size="compact-sm" onClick={onFinance}>{ui.openFinance}</CrmButton>}</div></TabCard>
      <TabCard title={ui.financeReminders}><EmptyState text={ui.financeNoReminders} compact /></TabCard>
    </div>
    <div className="orders-finance-summary-strip"><SummaryMetric label={ui.financeTotalPositions} value={String(items.length)}/><SummaryMetric label={ui.orderTotal} value={money(order.priceMinor,order.currency)}/><SummaryMetric label={ui.paid} value={money(paidMinor,order.currency)}/><SummaryMetric label={ui.balance} value={money(balance(order),order.currency)}/><SummaryMetric label={ui.financeLastPayment} value={latestPayment ? formatDate(latestPayment.receivedAt) : ui.notSpecified}/></div>
    {error && <CrmAlert onClose={()=>setError("")}>{error}</CrmAlert>}
    {voidTarget && onVoidPayment && <PaymentVoidDialog payment={voidTarget.payment} expectedOrderUpdatedAt={voidTarget.orderUpdatedAt} onVoid={onVoidPayment} onClose={()=>setVoidTarget(undefined)}/>}
    {discountOpen && compositionActions && <OrderDiscountEditor orderId={order.id} discountMinor={order.discountMinor || 0} currency={order.currency} bridge={compositionActions} onClose={() => setDiscountOpen(false)} />}
    {invoiceOpen && financeActions && <InvoiceEditor order={order} request={financeActions.request} close={()=>setInvoiceOpen(false)} done={()=>{setInvoiceOpen(false);void financeActions.onSaved().catch(reason=>setError(reason instanceof Error ? reason.message : ui.financeMutationFailed));}}/>}
  </div>;
}

function PaymentVoidDialog({payment,expectedOrderUpdatedAt,onVoid,onClose}:{payment:NonNullable<ExpandedOrderView["paymentHistory"]>[number];expectedOrderUpdatedAt:string;onVoid:NonNullable<TabCallbacks["onVoidPayment"]>;onClose:()=>void}) {
  const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef(false);
  async function submit(event:React.FormEvent){event.preventDefault();if(pending.current||reason.trim().length<2)return;pending.current=true;setBusy(true);setError("");try{await onVoid(payment.id,reason.trim(),expectedOrderUpdatedAt);onClose();}catch(problem){setError(problem instanceof Error ? problem.message : ui.financeMutationFailed);}finally{pending.current=false;setBusy(false);}}
  return <Modal opened onClose={()=>!busy&&onClose()} title={ui.voidPaymentTitle} aria-label={ui.voidPaymentTitle} centered size={520} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{"aria-label":ui.close,disabled:busy}}><form className="orders-payment-void-form" onSubmit={submit}><p>{ui.voidPaymentHint}</p><strong>{money(payment.amountMinor,payment.currency)} · {formatDate(payment.receivedAt)}</strong><CrmTextarea data-autofocus required minLength={2} maxLength={500} label={ui.voidPaymentReason} value={reason} disabled={busy} onChange={event=>setReason(event.currentTarget.value)} autosize minRows={3}/>{error && <CrmAlert>{error}</CrmAlert>}<footer><CrmButton tone="secondary" type="button" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy} disabled={busy||reason.trim().length<2}>{ui.voidPayment}</CrmButton></footer></form></Modal>;
}

function FinancialNotesEditor({note,loaded,orderId,actions}:{note?:StructuredOrderNote;loaded:boolean;orderId:string;actions?:TabCallbacks["financeActions"]}) {
  const [value,setValue]=useState(note?.body || ""),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const original=useRef(note),pending=useRef(false);
  useEffect(()=>{
    if(!dirty && !pending.current && (!original.current || (note && Date.parse(note.updatedAt) >= Date.parse(original.current.updatedAt)))) {
      original.current=note;setValue(note?.body || "");
    }
  },[note,dirty]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending.current||!value.trim()||!actions)return;
    pending.current=true;setBusy(true);setError("");
    try{
      const input={category:"FINANCE",visibility:"INTERNAL",title:ui.financialNotes,body:value.trim()};
      const saved=await actions.request(original.current ? `/order-tabs/${orderId}/notes/${original.current.id}` : `/order-tabs/${orderId}/notes`,{method:original.current?"PATCH":"POST",body:JSON.stringify({...input,...(original.current?{expectedUpdatedAt:original.current.updatedAt}:{})})});
      original.current=saved;setDirty(false);
      try{await actions.onSaved();}catch{setError(ui.financeNotesSavedRefreshWarning);}
    }catch(problem){setError(problem instanceof Error?problem.message:ui.financeMutationFailed);}
    finally{pending.current=false;setBusy(false);}
  }
  return <form className="orders-finance-notes-form" onSubmit={submit}><CrmTextarea aria-label={ui.financialNotes} placeholder={ui.financeNotesPlaceholder} value={value} onChange={event=>{setValue(event.currentTarget.value);setDirty(true);}} disabled={busy||!actions||!loaded} autosize minRows={3} maxRows={6}/>{error&&<CrmAlert>{error}</CrmAlert>}<CrmButton type="submit" loading={busy} disabled={!actions||!loaded||!dirty||!value.trim()}>{ui.save}</CrmButton></form>;
}

function OrderProductionTab({ order, items, onProduction, onUpdateInstance, statusPending }: Props & { items: ExpandedOrderItem[] }) {
  const requiresProduction = !NON_PRODUCTION_ORDER_TYPES.has(order.type);
  const canSchedule = requiresProduction && order.salesStatus !== 'COMPLETED';
  const instanceRows = items.flatMap((item) => item.instances?.map((instance) => ({ item, instance })) ?? []);
  const scheduledCount = instanceRows.filter(({ instance }) => instance.productionStatus !== "NOT_SCHEDULED" && instance.productionStatus !== "CANCELLED").length;
  const loadPercent = instanceRows.length ? Math.round(scheduledCount / instanceRows.length * 100) : 0;
  const requirements = productionPropertyLines(items, ["requirements", "technicalRequirements", "features"]);
  const materials = productionPropertyLines(items, ["materials", "fabrics"]);
  return <div className="orders-tab-production-approved">
    <TabCard className="orders-production-plan" title={ui.productionPlan} action={canSchedule ? <CrmButton size="compact-xs" onClick={onProduction}>{order.productionSlot ? ui.editDates : ui.scheduleProduction}</CrmButton> : undefined}>
      {requiresProduction ? <div className="orders-production-current"><span><small>{ui.currentStatus}</small><strong>{order.salesStatus==='COMPLETED'?ui.productionFulfilled:coarseProductionLabel(productionStatusForDisplay(order))}</strong></span><span><small>{ui.plannedDates}</small><strong>{order.productionSlot ? slotDateRange(order) : ui.notSpecified}</strong></span><span><small>{ui.slotCapacity}</small><strong>{order.productionSlot ? String(order.productionSlot.capacity) : ui.notSpecified}</strong></span></div> : <EmptyState text={ui.productionNotRequired} />}
    </TabCard>
    <TabCard className="orders-production-schedule" title={ui.productionSchedulePreview}><ProductionSchedulePreview order={order} items={items} rows={instanceRows} onOpen={canSchedule?onProduction:undefined} /></TabCard>
    <TabCard className="orders-tab-span-8" title={ui.productsInOrder}>
      <div className="orders-production-items"><header><span>#</span><span>{ui.designModel}</span><span>{ui.athlete}</span><span>{ui.dimensions}</span><span>{ui.productionStatus}</span><span>{ui.plannedDate}</span></header>{instanceRows.length ? instanceRows.map(({ item, instance }) => <div key={instance.id}><b>{displayInstanceNumber(items, item, instance.ordinal)}</b><span>{item.name}</span><span>{instance.athlete ? athleteName(instance.athlete) : ui.notSpecifiedFeminine}</span><span>{instance.measurement ? formatDate(instance.measurement.measuredAt) : ui.notReceived}</span><div className="orders-instance-production-status"><CrmNativeSelect aria-label={`${ui.productionStatus}: ${displayInstanceNumber(items, item, instance.ordinal)}`} disabled={statusPending||order.salesStatus==='COMPLETED'} value={coarseProductionCode(instance.productionStatus)} onChange={(event) => void onUpdateInstance(instance.id,{productionStatus:event.currentTarget.value,expectedUpdatedAt:instance.updatedAt})} data={INSTANCE_PRODUCTION_STATUSES.map((status) => ({value:status,label:coarseProductionLabel(status)}))}/>{isInstanceOverdue(instance)&&<small>{ui.productionOverdue}</small>}</div><span>{instance.plannedStartAt ? formatDate(instance.plannedStartAt) : ui.notSpecifiedFeminine}</span></div>) : <EmptyState text={ui.instancesUnavailable} />}</div>
    </TabCard>
    <TabCard className="orders-tab-span-4" title={ui.productionLoad}><div className="orders-production-load"><strong>{scheduledCount} {ui.of} {instanceRows.length} {ui.itemsScheduled}</strong><div><i style={{ width: `${loadPercent}%` }} /></div><b>{loadPercent}%</b></div></TabCard>
    <TabCard className="orders-tab-span-4" title={ui.technicalRequirements}>{requirements.length ? <BulletList values={requirements} /> : <EmptyState text={ui.productionRequirementsUnavailable} compact />}</TabCard>
    <TabCard className="orders-tab-span-4" title={ui.materials}>{materials.length ? <BulletList values={materials} /> : <EmptyState text={ui.productionMaterialsUnavailable} compact />}</TabCard>
    <TabCard className="orders-tab-span-4" title={ui.productionNotes}><p className="orders-tab-note">{order.managerComment || ui.notSpecified}</p></TabCard>
  </div>;
}

function OrderDeliveryTab({ order, items, onDelivery, onDeliveryContact, onCreateShipment, onUpdateShipment, targetShipmentId }: Props & { items: ExpandedOrderItem[]; targetShipmentId?: string }) {
  const targetShipmentRef = useRef<HTMLElement | null>(null);
  const targetShipmentExists = Boolean(targetShipmentId && order.orderShipments?.some(shipment => shipment.id === targetShipmentId));
  useEffect(() => {
    if (!targetShipmentExists) return;
    const frame = requestAnimationFrame(() => {
      targetShipmentRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
      targetShipmentRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [targetShipmentExists, targetShipmentId]);
  const tracking = trackingNumber(order);
  const [shipmentEditor, setShipmentEditor] = useState<{ shipment?: OrderShipmentView }>();
  const editingShipment = shipmentEditor?.shipment;
  const instanceOptions = items.flatMap((item) => (item.instances ?? []).map((instance) => ({ item, instance })));
  return <div className="orders-tab-delivery-approved">
    <TabCard className="orders-delivery-address" title={ui.deliveryAddress} action={<CrmButton tone="secondary" size="compact-xs" onClick={onDelivery}>{ui.edit}</CrmButton>}>
      <FieldGrid single><Field label={ui.recipient} value={deliveryRecipient(order)} /><Field label={ui.address} value={deliveryPlace(order)} /><Field label={ui.country} value={countryLabel(deliveryCountry(order)) || ui.notSpecifiedFeminine} /><EditableField label={ui.phone} value={order.deliveryRecipientPhone || order.client.phone || ui.notSpecified} onClick={onDeliveryContact} /><Field label={ui.email} value={(order as ExpandedOrderView & { deliveryEmail?: string }).deliveryEmail || order.client.email || ui.notSpecified} /></FieldGrid>
    </TabCard>
    <div className="orders-shipment-column">
      <header className="orders-tab-section-header"><div><h3>{ui.shipments}</h3><p>{ui.shipmentsRealDataHint}</p></div>{onCreateShipment && <CrmButton size="compact-sm" onClick={() => setShipmentEditor({})}>＋ {ui.addShipment}</CrmButton>}</header>
      {targetShipmentId && !targetShipmentExists && <CrmAlert className="orders-shipment-context-missing">{overviewContextUi.shipmentUnavailable}</CrmAlert>}
      {order.orderShipments?.length ? order.orderShipments.map((shipment, index) => <article className="orders-shipment-card" key={shipment.id} data-shipment-id={shipment.id} data-context-selected={shipment.id === targetShipmentId ? "true" : undefined} tabIndex={shipment.id === targetShipmentId ? -1 : undefined} ref={shipment.id === targetShipmentId ? targetShipmentRef : undefined}><header><span>{index + 1}</span><div><h4>{ui.shipmentNumber} {index + 1}</h4><CrmStatusBadge domain="shipping" status={shipment.status} /></div>{onUpdateShipment && <CrmButton tone="secondary" size="compact-xs" onClick={() => setShipmentEditor({ shipment })}>{ui.editShipment}</CrmButton>}</header><FieldGrid><Field label={ui.method} value={shipmentMethodLabel(shipment)} /><Field label={ui.tracking} value={shipment.trackingNumber || ui.notSpecified} /><Field label={ui.actualShipping} value={shipment.shippedAt ? formatDate(shipment.shippedAt) : ui.notSpecifiedFeminine} /><Field label={ui.actualDelivery} value={shipment.deliveredAt ? formatDate(shipment.deliveredAt) : ui.notSpecifiedFeminine} /><Field label={ui.shipmentWeight} value={shipment.weightGrams ? `${shipment.weightGrams} ${ui.grams}` : ui.notSpecified} /><Field label={ui.shipmentDimensions} value={shipment.lengthMm && shipment.widthMm && shipment.heightMm ? `${shipment.lengthMm} × ${shipment.widthMm} × ${shipment.heightMm} ${ui.millimeters}` : ui.notSpecified} /><Field label={ui.shippingPaidByClient} value={money(shipment.customerChargeMinor, shipment.currency)} /><Field label={ui.shippingAtelierExpense} value={money(shipment.atelierCostMinor, shipment.currency)} /></FieldGrid><div className="orders-shipment-contents"><strong>{ui.shipmentContents}</strong>{shipment.instances.length ? shipment.instances.map((instance) => { const item = items.find((candidate) => candidate.id === instance.orderItemId); return <span key={instance.id}>{item?.name || ui.item} · {item ? displayInstanceNumber(items, item, instance.ordinal) : instance.ordinal}</span>; }) : <small>{ui.noShipmentContents}</small>}</div></article>) : <EmptyState text={ui.noShipment} action={onCreateShipment ? <CrmButton size="compact-sm" onClick={() => setShipmentEditor({})}>{ui.addShipment}</CrmButton> : <CrmButton tone="secondary" size="compact-sm" onClick={onDelivery}>{ui.editDeliveryAddress}</CrmButton>} />}
      {onCreateShipment && <UnstyledButton className="orders-add-shipment-card" onClick={() => setShipmentEditor({})}>＋ {ui.addShipment}</UnstyledButton>}
    </div>
    <aside className="orders-delivery-side"><TabCard title={ui.tracking}>{tracking ? <><strong className="orders-tracking-number">{tracking}</strong><p>{shipmentMethod(order)}</p>{trackingUrl(order) && <a className="orders-tracking-link" href={trackingUrl(order)!} target="_blank" rel="noreferrer">{ui.trackAtCarrier}</a>}</> : <EmptyState text={ui.trackingMissing} />}</TabCard><TabCard title={ui.usefulLinks}><div className="orders-carrier-links">{carrierLinks().map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>)}</div></TabCard></aside>
    <Modal opened={Boolean(shipmentEditor)} onClose={() => setShipmentEditor(undefined)} title={editingShipment ? ui.editShipment : ui.addShipment} aria-label={editingShipment ? ui.editShipment : ui.addShipment} closeButtonProps={{ "aria-label": ui.close }} closeOnEscape returnFocus centered size={720}>{shipmentEditor && <OrderShipmentForm order={order} shipment={editingShipment} instances={instanceOptions} onCancel={() => setShipmentEditor(undefined)} onSubmit={async (input) => { if (editingShipment && onUpdateShipment) await onUpdateShipment(editingShipment.id, input); else if (onCreateShipment) await onCreateShipment(input); setShipmentEditor(undefined); }} />}</Modal>
  </div>;
}

function OrderShipmentForm({ order, shipment, instances, onCancel, onSubmit }: { order: ExpandedOrderView; shipment?: OrderShipmentView; instances: Array<{ item: ExpandedOrderItem; instance: OrderItemInstanceView }>; onCancel: () => void; onSubmit: (input: OrderShipmentInput) => Promise<void> }) {
  const availableInstances = instances.filter(({ instance }) => !instance.orderShipment || instance.orderShipment?.id === shipment?.id);
  const [carrier, setCarrier] = useState(shipment?.carrier || "NOVA_POSHTA");
  const [trackingNumber, setTrackingNumber] = useState(shipment?.trackingNumber || "");
  const [customerCharge, setCustomerCharge] = useState(minorInput(shipment?.customerChargeMinor || 0));
  const [atelierCost, setAtelierCost] = useState(minorInput(shipment?.atelierCostMinor || 0));
  const [status, setStatus] = useState(shipment?.status || "NOT_READY");
  const [shippedAt, setShippedAt] = useState(dateInput(shipment?.shippedAt));
  const [deliveredAt, setDeliveredAt] = useState(dateInput(shipment?.deliveredAt));
  const [weightGrams, setWeightGrams] = useState(optionalNumberInput(shipment?.weightGrams));
  const [lengthMm, setLengthMm] = useState(optionalNumberInput(shipment?.lengthMm));
  const [widthMm, setWidthMm] = useState(optionalNumberInput(shipment?.widthMm));
  const [heightMm, setHeightMm] = useState(optionalNumberInput(shipment?.heightMm));
  const [instanceIds, setInstanceIds] = useState(() => new Set(shipment?.instances.map((instance) => instance.id) ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customerChargeMinor = parseShipmentMinor(customerCharge), atelierCostMinor = parseShipmentMinor(atelierCost);
    if (customerChargeMinor == null || atelierCostMinor == null) { setError(ui.shipmentMoneyInvalid); return; }
    const optionalNumbers = [weightGrams, lengthMm, widthMm, heightMm].map(parseOptionalPositiveInteger);
    if (optionalNumbers.some((value) => value === null)) { setError(ui.shipmentDimensionsInvalid); return; }
    setBusy(true); setError("");
    try {
      await onSubmit({ carrier, trackingNumber: trackingNumber.trim() || null, customerChargeMinor, atelierCostMinor, currency: order.currency, status, shippedAt: dateTimeOrNull(shippedAt), deliveredAt: dateTimeOrNull(deliveredAt), ...(optionalNumbers[0] ? { weightGrams: optionalNumbers[0] } : {}), ...(optionalNumbers[1] ? { lengthMm: optionalNumbers[1] } : {}), ...(optionalNumbers[2] ? { widthMm: optionalNumbers[2] } : {}), ...(optionalNumbers[3] ? { heightMm: optionalNumbers[3] } : {}), instanceIds: [...instanceIds], ...(shipment ? { expectedUpdatedAt: shipment.updatedAt } : {}) });
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="orders-shipment-form" onSubmit={submit}>
    <div className="orders-shipment-form-grid"><CrmNativeSelect data-autofocus label={ui.shipmentCarrier} value={carrier} onChange={(event) => setCarrier(event.currentTarget.value)} data={Object.entries(ui.carriers).map(([value, label]) => ({ value, label }))} /><CrmNativeSelect label={ui.shipmentStatus} value={status} onChange={(event) => setStatus(event.currentTarget.value)} data={Object.entries(ui.shipmentStatusLabels).map(([value, label]) => ({ value, label }))} /><CrmTextInput highlighted label={ui.tracking} value={trackingNumber} onChange={(event) => setTrackingNumber(event.currentTarget.value)} maxLength={120} /><CrmNativeSelect label={ui.currency} value={order.currency} data={[order.currency]} disabled /><CrmTextInput highlighted label={ui.shippingPaidByClient} value={customerCharge} onChange={(event) => setCustomerCharge(event.currentTarget.value)} inputMode="decimal" required /><CrmTextInput highlighted label={ui.shippingAtelierExpense} value={atelierCost} onChange={(event) => setAtelierCost(event.currentTarget.value)} inputMode="decimal" required /><CrmTextInput label={ui.actualShipping} type="date" value={shippedAt} onChange={(event) => setShippedAt(event.currentTarget.value)} /><CrmTextInput label={ui.actualDelivery} type="date" value={deliveredAt} onChange={(event) => setDeliveredAt(event.currentTarget.value)} /><CrmTextInput label={ui.shipmentWeight} type="number" min={1} max={100000} value={weightGrams} onChange={(event) => setWeightGrams(event.currentTarget.value)} /><CrmTextInput label={ui.shipmentLength} type="number" min={1} max={10000} value={lengthMm} onChange={(event) => setLengthMm(event.currentTarget.value)} /><CrmTextInput label={ui.shipmentWidth} type="number" min={1} max={10000} value={widthMm} onChange={(event) => setWidthMm(event.currentTarget.value)} /><CrmTextInput label={ui.shipmentHeight} type="number" min={1} max={10000} value={heightMm} onChange={(event) => setHeightMm(event.currentTarget.value)} /></div>
    <fieldset className="orders-shipment-instances"><legend>{ui.shipmentInstances}</legend>{availableInstances.length ? availableInstances.map(({ item, instance }) => <CrmCheckbox key={instance.id} checked={instanceIds.has(instance.id)} onChange={(event) => setInstanceIds((current) => { const next = new Set(current); event.currentTarget.checked ? next.add(instance.id) : next.delete(instance.id); return next; })} label={`${item.name} · ${displayInstanceNumber(expandedOrderItems(order), item, instance.ordinal)}${instance.athlete ? ` · ${athleteName(instance.athlete)}` : ""}`} />) : <p>{ui.noAvailableShipmentInstances}</p>}</fieldset>
    {error && <CrmAlert onClose={() => setError("")}>{error}</CrmAlert>}
    <footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onCancel}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.saveShipment}</CrmButton></footer>
  </form>;
}

function OrderNotesTab({ order, onCustomerWishes, onManagerComment, onCreateNote, onUpdateNote, onArchiveNote, onUploadFile }: Props) {
  const notes = order.notesStructured ?? [];
  const [noteEditor, setNoteEditor] = useState<{ note?: StructuredOrderNote }>({});
  const [archiveTarget, setArchiveTarget] = useState<StructuredOrderNote>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editingNote = noteEditor?.note;
  async function saveNote(input: OrderNoteInput) {
    setBusy(true); setError("");
    try {
      if (editingNote) await onUpdateNote(editingNote.id, { ...input, expectedUpdatedAt: editingNote.updatedAt });
      else await onCreateNote(input);
      setNoteEditor({});
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function archiveNote(note: StructuredOrderNote) {
    if (!onArchiveNote) return;
    setBusy(true); setError("");
    try { await onArchiveNote(note.id); setArchiveTarget(undefined); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="orders-tab-notes-approved">
    <aside className="orders-note-categories"><h3>{ui.noteCategories}</h3><span className="active"><b>{ui.allNotes}</b><i>{notes.length}</i></span>{Object.keys(ui.noteCategoryLabels).map((category) => <span key={category}><b>{categoryLabel(category)}</b><i>{notes.filter((note) => note.category === category).length}</i></span>)}</aside>
    <div className="orders-note-list"><header className="orders-tab-section-header"><div><h3>{ui.tabs.notes} ({notes.length || Number(Boolean(order.buyerComment || order.notes || order.managerComment))})</h3><p>{ui.notesVisibilityHint}</p></div><CrmButton size="compact-sm" onClick={() => { setError(""); setNoteEditor({}); }}>＋ {ui.addNote}</CrmButton></header>{notes.length ? notes.map((note) => <article key={note.id}><span>{categoryLabel(note.category)}</span><div><h4>{note.title}</h4><p>{note.body}</p><small>{note.author?.displayName || ui.systemUser} · {formatDateTime(note.updatedAt)} · {visibilityLabel(note.visibility)}</small><div className="orders-note-actions"><CrmButton tone="secondary" size="compact-xs" onClick={() => { setError(""); setNoteEditor({ note }); }}>{ui.editNote}</CrmButton>{onArchiveNote && <CrmButton tone="secondary" color="red" size="compact-xs" onClick={() => { setError(""); setArchiveTarget(note); }}>{ui.archiveNote}</CrmButton>}</div></div></article>) : <><article><span>{ui.customer}</span><div><h4>{ui.customerWishes}</h4><p>{order.buyerComment || order.notes || ui.notSpecified}</p><CrmButton tone="secondary" size="compact-xs" onClick={onCustomerWishes}>{ui.edit}</CrmButton></div></article><article><span>{ui.internal}</span><div><h4>{ui.managerNotes}</h4><p>{order.managerComment || ui.notSpecified}</p><CrmButton tone="secondary" size="compact-xs" onClick={onManagerComment}>{ui.editNote}</CrmButton></div></article></>}</div>
    <TabCard className="orders-note-editor-placeholder" title={editingNote ? ui.editNote : ui.addNote}><OrderNoteForm key={editingNote?.id || "new"} note={editingNote} busy={busy} error={error} onCancel={() => setNoteEditor({})} onSubmit={saveNote} onUploadFile={onUploadFile} /></TabCard>
    <Modal opened={Boolean(archiveTarget)} onClose={() => !busy && setArchiveTarget(undefined)} title={ui.archiveNote} aria-label={ui.archiveNote} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} closeOnEscape={!busy} closeOnClickOutside={!busy} returnFocus centered size={440}>{archiveTarget && <div className="orders-note-archive"><p>{ui.archiveNoteConfirm.replace("{title}", archiveTarget.title)}</p>{error && <CrmAlert onClose={() => setError("")}>{error}</CrmAlert>}<footer><CrmButton tone="secondary" disabled={busy} onClick={() => setArchiveTarget(undefined)}>{ui.cancel}</CrmButton><CrmButton color="red" loading={busy} onClick={() => void archiveNote(archiveTarget)}>{ui.archiveNote}</CrmButton></footer></div>}</Modal>
  </div>;
}

function OrderNoteForm({ note, busy, error, onCancel, onSubmit, onUploadFile }: { note?: StructuredOrderNote; busy: boolean; error: string; onCancel: () => void; onSubmit: (input: OrderNoteInput) => Promise<void>; onUploadFile: (file: File) => Promise<void> }) {
  const [category, setCategory] = useState(note?.category || "GENERAL");
  const [visibility, setVisibility] = useState(note?.visibility || "INTERNAL");
  const [title, setTitle] = useState(note?.title || "");
  const [body, setBody] = useState(note?.body || "");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function formatBody(prefix: string, suffix: string = prefix, placeholder: string = ui.noteFormatPlaceholder) {
    const element = textarea.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || placeholder;
    const next = `${body.slice(0, start)}${prefix}${selected}${suffix}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }
  function formatLines(marker: string) {
    const element = textarea.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || ui.noteFormatPlaceholder;
    const formatted = selected.split("\n").map((line, index) => marker === "1. " ? `${index + 1}. ${line}` : `${marker}${line}`).join("\n");
    setBody(`${body.slice(0, start)}${formatted}${body.slice(end)}`);
    requestAnimationFrame(() => element?.focus());
  }
  async function upload(file?: File) {
    if (!file || fileBusy) return;
    setFileBusy(true); setFileError("");
    try { await onUploadFile(file); }
    catch (reason) { setFileError((reason as Error).message); }
    finally { setFileBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  return <form className="orders-note-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ category, visibility, title: title.trim(), body: body.trim() }); }}>
    <div className="orders-note-form-grid"><CrmNativeSelect data-autofocus label={ui.noteCategory} value={category} onChange={(event) => setCategory(event.currentTarget.value)} data={Object.keys(ui.noteCategoryLabels).map((value) => ({ value, label: categoryLabel(value) }))} /><CrmNativeSelect label={ui.noteVisibility} value={visibility} onChange={(event) => setVisibility(event.currentTarget.value)} data={Object.entries(ui.noteVisibilityLabels).map(([value, label]) => ({ value, label }))} /></div>
    <CrmTextInput highlighted label={ui.noteTitle} value={title} onChange={(event) => setTitle(event.currentTarget.value)} minLength={1} maxLength={160} required />
    <div className="orders-note-format-toolbar" role="toolbar" aria-label={ui.noteFormatting}>
      <UnstyledButton type="button" aria-label={ui.noteBold} title={ui.noteBold} onClick={() => formatBody("**")}><b>B</b></UnstyledButton>
      <UnstyledButton type="button" aria-label={ui.noteItalic} title={ui.noteItalic} onClick={() => formatBody("_")}><i>I</i></UnstyledButton>
      <UnstyledButton type="button" aria-label={ui.noteUnderline} title={ui.noteUnderline} onClick={() => formatBody("<u>", "</u>")}><u>U</u></UnstyledButton>
      <UnstyledButton type="button" aria-label={ui.noteBulletedList} title={ui.noteBulletedList} onClick={() => formatLines("- ")}>•</UnstyledButton>
      <UnstyledButton type="button" aria-label={ui.noteNumberedList} title={ui.noteNumberedList} onClick={() => formatLines("1. ")}>1.</UnstyledButton>
      <UnstyledButton type="button" aria-label={ui.noteLink} title={ui.noteLink} onClick={() => formatBody("[", "](https://)", ui.noteLinkPlaceholder)}>↗</UnstyledButton>
    </div>
    <CrmTextarea ref={textarea} highlighted label={ui.noteBody} value={body} onChange={(event) => setBody(event.currentTarget.value)} minLength={1} maxLength={10000} autosize minRows={5} maxRows={12} required />
    <div className="orders-note-file-row"><input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,text/plain,.ai,application/postscript" onChange={(event) => void upload(event.currentTarget.files?.[0])} /><CrmButton type="button" tone="secondary" size="compact-xs" loading={fileBusy} onClick={() => fileInput.current?.click()}>＋ {ui.attachFileToNote}</CrmButton><small>{ui.noteFileHint}</small></div>
    {fileError && <CrmAlert onClose={() => setFileError("")}>{fileError}</CrmAlert>}
    {error && <CrmAlert onClose={() => undefined}>{error}</CrmAlert>}
    <footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onCancel}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy} disabled={!title.trim() || !body.trim()}>{ui.saveNote}</CrmButton></footer>
  </form>;
}

function OrderHistoryTab({ order }: { order: ExpandedOrderView }) {
  const [eventType, setEventType] = useState("");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const eventTypes = [...new Set(order.activities.map((activity) => activity.type))];
  const actors = [...new Map(order.activities.filter((activity) => activity.actor).map((activity) => [activity.actor!.id, activity.actor!])).values()];
  const filtered = useMemo(() => order.activities.filter((activity) => {
    const created = activity.createdAt.slice(0, 10);
    return (!eventType || activity.type === eventType) && (!actorId || activity.actor?.id === actorId) && (!dateFrom || created >= dateFrom) && (!dateTo || created <= dateTo) && (!query.trim() || repairMojibake(activity.summary).toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  }), [order.activities, eventType, actorId, dateFrom, dateTo, query]);
  const activities = filtered.slice(0, limit);
  return <div className="orders-tab-history-approved">
    <div className="orders-history-main"><header className="orders-tab-section-header"><div><h3>{ui.orderHistory}</h3><p>{ui.historyImmutableHint}</p></div></header><div className="orders-history-filters"><CrmNativeSelect aria-label={ui.eventType} value={eventType} onChange={(event) => { setEventType(event.currentTarget.value); setLimit(8); }} data={[{ value: "", label: ui.allEvents }, ...eventTypes.map((value) => ({ value, label: activityTypeLabel(value) }))]} /><CrmNativeSelect aria-label={ui.user} value={actorId} onChange={(event) => { setActorId(event.currentTarget.value); setLimit(8); }} data={[{ value: "", label: ui.allUsers }, ...actors.map((actor) => ({ value: actor.id, label: actor.displayName }))]} /><CrmTextInput aria-label={ui.dateFrom} type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.currentTarget.value); setLimit(8); }} /><CrmTextInput aria-label={ui.dateTo} type="date" value={dateTo} onChange={(event) => { setDateTo(event.currentTarget.value); setLimit(8); }} /><CrmTextInput aria-label={ui.searchHistory} placeholder={ui.searchHistory} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setLimit(8); }} /></div><div className="orders-history-table-head"><span>{ui.dateAndTime}</span><span>{ui.event}</span><span>{ui.description}</span><span>{ui.user}</span></div>{activities.length ? <ActivityList activities={activities} rich /> : <EmptyState text={ui.noFilteredHistory} />}{filtered.length > limit && <CrmButton tone="secondary" size="compact-sm" onClick={() => setLimit((value) => value + 8)}>{`${ui.showMoreEvents} (${filtered.length - limit})`}</CrmButton>}</div>
    <aside className="orders-history-side"><TabCard title={ui.orderStatistics}><SummaryMetric label={ui.totalEvents} value={String(order.activities.length)} /><SummaryMetric label={ui.tabs.notes} value={String(order.notesStructured?.length ?? Number(Boolean(order.buyerComment || order.notes || order.managerComment)))} /><SummaryMetric label={ui.clientPayments} value={String((order.paymentHistory ?? order.payments).length)} /><SummaryMetric label={ui.files} value={String(order.files?.length ?? 0)} /></TabCard><TabCard title={ui.latestFiles}>{order.files?.length ? order.files.slice(0, 4).map((file) => <FileRow key={file.id} file={file} />) : <EmptyState text={ui.noFiles} />}</TabCard></aside>
  </div>;
}

function ProductionSchedulePreview({ order, items, rows, onOpen }: { order: ExpandedOrderView; items: ExpandedOrderItem[]; rows: Array<{ item: ExpandedOrderItem; instance: OrderItemInstanceView }>; onOpen?: () => void }) {
  if (!order.productionSlot) return <EmptyState text={order.salesStatus==='COMPLETED'?ui.productionFulfilled:ui.productionScheduleOpenHint} action={onOpen?<CrmButton tone="secondary" size="compact-sm" onClick={onOpen}>{ui.openProduction}</CrmButton>:undefined} />;
  const start = new Date(order.productionSlot.startsAt);
  const end = new Date(order.productionSlot.endsAt);
  const days = Array.from({ length: Math.max(1, Math.min(14, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1)) }, (_, index) => new Date(start.getTime() + index * 86400000));
  return <div className="orders-production-calendar"><header><strong>{formatDate(order.productionSlot.startsAt)} — {formatDate(order.productionSlot.endsAt)}</strong>{onOpen&&<CrmButton tone="secondary" size="compact-xs" onClick={onOpen}>{ui.openProduction}</CrmButton>}</header><div className="orders-production-calendar-days">{days.map((day) => <span key={day.toISOString()}><small>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(day)}</small><b>{day.getDate()}</b></span>)}</div><div className="orders-production-calendar-rows">{rows.length ? rows.slice(0, 4).map(({ item, instance }) => <div key={instance.id}><strong>{displayInstanceNumber(items, item, instance.ordinal)} {item.name}</strong><span className={instance.productionStatus === "NOT_SCHEDULED" ? "is-empty" : ""}>{orderLabel("production", instance.productionStatus)}</span></div>) : <EmptyState text={ui.instancesUnavailable} compact />}</div></div>;
}

function BulletList({ values }: { values: string[] }) { return <ul className="orders-approved-bullets">{values.map((value) => <li key={value}>{value}</li>)}</ul>; }

function TabCard({ title, action, className = "", children }: { title: string; action?: ReactNode; className?: string; children: ReactNode }) { return <section className={`orders-approved-card ${className}`.trim()}><header><h3>{title}</h3>{action}</header>{children}</section>; }
function FieldGrid({ single, children }: { single?: boolean; children: ReactNode }) { return <div className={`orders-field-grid${single ? " is-single" : ""}`}>{children}</div>; }
function Field({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "danger" }) { return <div className={`orders-approved-field${tone ? ` is-${tone}` : ""}`}><small>{label}</small><strong>{value}</strong></div>; }
function EditableField({ label, value, onClick }: { label: string; value: ReactNode; onClick: () => void }) { return <UnstyledButton className="orders-approved-field is-editable" onClick={onClick}><small>{label}</small><strong>{value}</strong></UnstyledButton>; }
function EmptyState({ text, compact, action }: { text: string; compact?: boolean; action?: ReactNode }) { return <div className={`orders-approved-empty${compact ? " is-compact" : ""}`}><span>—</span><p>{text}</p>{action}</div>; }
function SummaryMetric({ label, value }: { label: string; value: string }) { return <div className="orders-summary-metric"><small>{label}</small><strong>{value}</strong></div>; }
function Stage({ icon, label, value }: { icon: string; label: string; value: string }) { return <div><TabIcon name={icon} /><span><strong>{label}</strong><small>{value}</small></span></div>; }
function MoneyRow({ label, value, currency, strong, tone, onEdit }: { label: string; value: number | null; currency: string; strong?: boolean; tone?: "success" | "danger"; onEdit?: () => void }) { return <div className={`orders-approved-money${strong ? " is-strong" : ""}${tone ? ` is-${tone}` : ""}`}><span>{label}</span>{onEdit ? <UnstyledButton onClick={onEdit} aria-label={orderDiscountUi.title}><b><u>{money(value, currency)}</u> ✎</b></UnstyledButton> : <b>{money(value, currency)}</b>}</div>; }
function ClientIdentity({ order, large }: { order: ExpandedOrderView; large?: boolean }) { return <div className={`orders-client-identity${large ? " is-large" : ""}`}><span className="orders-client-portrait"><TabIcon name="client" /><small>{initials(order.client.displayName)}</small></span><div><strong>{order.client.displayName}</strong><small>{countryLabel(order.client.country) || ui.notSpecifiedFeminine}</small></div></div>; }
function ItemThumb({ item }: { item: ExpandedOrderItem }) { const image = itemImage(item); return image ? <img className="orders-item-thumb" src={image} alt={item.name} /> : <span className="orders-item-thumb is-empty"><TabIcon name="designs" /></span>; }

function OrderImageEditor({ item, onImage }: { item: ExpandedOrderItem; onImage: TabCallbacks["onImage"] }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function select(file?: File) { if (!file || busy) return; setBusy(true); try { await onImage(item.persistedItemId, item.modelImagePath ?? null, file); } finally { setBusy(false); if (input.current) input.current.value = ""; } }
  return <div className="orders-design-image-editor orders-item-image-editor"><ItemThumb item={item} /><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void select(event.currentTarget.files?.[0])} /><CrmActionIcon disabled={busy} onClick={() => input.current?.click()} aria-label={`${ui.changeOrderItemImage}: ${item.name}`}><TabIcon name="edit" /></CrmActionIcon></div>;
}

function OrderFilesCard({ order, onUpload, className }: { order: ExpandedOrderView; onUpload: (file: File) => Promise<void>; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ src: string; name: string }>();
  const files = order.files ?? [];
  async function select(file?: File) { if (!file || busy) return; setBusy(true); setError(""); try { await onUpload(file); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; } }
  return <TabCard className={className} title={`${ui.files} (${files.length})`} action={<><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,text/plain,.ai,application/postscript" onChange={(event) => void select(event.currentTarget.files?.[0])} /><CrmButton tone="secondary" size="compact-xs" loading={busy} onClick={() => input.current?.click()}>＋ {ui.addFile}</CrmButton></>}>
    {files.length ? <div className="orders-approved-files">{files.map((file) => file.mimeType.startsWith("image/") ? <UnstyledButton key={file.id} onClick={() => setPreview({ src: `/api/orders/files/${file.path}`, name: file.name })}><img src={`/api/orders/files/${file.path}`} alt={file.name} /><span>{file.name}</span></UnstyledButton> : <a key={file.id} href={`/api/orders/files/${file.path}`} target="_blank" rel="noreferrer"><TabIcon name="file" /><span>{file.name}</span></a>)}</div> : <EmptyState text={ui.noFiles} compact />}
    {error && <CrmAlert onClose={() => setError("")}>{error}</CrmAlert>}
    <Modal opened={Boolean(preview)} onClose={() => setPreview(undefined)} title={preview?.name || ui.imagePreview} aria-label={ui.imagePreview} closeButtonProps={{ "aria-label": ui.closePreview }} centered size="auto"><div className="orders-file-preview">{preview && <img className="orders-approved-preview" src={preview.src} alt={preview.name} />}</div></Modal>
  </TabCard>;
}

function InstanceRow({ item, instance, order, onAssign }: { item: ExpandedOrderItem; instance: OrderItemInstanceView; order: ExpandedOrderView; onAssign: () => void }) {
  const measurement = ownedMeasurement(instance.measurement ?? undefined, instance.athlete ?? undefined);
  return <div className="orders-instance-row"><b>{displayInstanceNumber(expandedOrderItems(order), item, instance.ordinal)}</b><span><small>{ui.athlete}</small><strong>{instance.athlete ? athleteName(instance.athlete) : ui.notSpecifiedFeminine}</strong></span><div className="orders-instance-measurements">{basicMeasurementNumbers.map(number => <span key={number}><small title={measurementFieldLabels[number - 1]}>{`№${number} · ${measurementFieldLabels[number - 1]}`}</small><strong>{measurement?.values?.[`m${number}`] == null ? "—" : `${formatCm(measurement.values[`m${number}`]!)} см`}</strong></span>)}</div><CrmStatusBadge domain="production" status={instance.productionStatus} /><CrmActionIcon onClick={onAssign} aria-label={`${ui.assignAthleteAndMeasurements}: ${displayInstanceNumber(expandedOrderItems(order), item, instance.ordinal)}`}><TabIcon name="edit" /></CrmActionIcon></div>;
}
function ActivityList({ activities, rich }: { activities: ExpandedOrderView["activities"]; rich?: boolean }) { return <div className={`orders-approved-activities${rich ? " is-rich" : ""}`}>{activities.map((activity) => <div key={activity.id}><span>{formatDateTime(activity.createdAt)}</span><i><TabIcon name="history" /></i><strong>{repairMojibake(activity.summary)}</strong>{rich && <small>{activity.actor?.displayName || ui.systemUser}</small>}</div>)}</div>; }
function FileRow({ file }: { file: { name: string; mimeType: string; sizeBytes: number; createdAt: string; path?: string } }) { return <div className="orders-approved-file-row"><TabIcon name="file" /><span><strong>{file.name}</strong><small>{formatFileSize(file.sizeBytes)} · {formatDate(file.createdAt)}</small></span></div>; }

function MeasurementGrid({ measurement, numbers = Array.from({ length: 17 }, (_, index) => index + 1) }: { measurement: NonNullable<Order["measurement"]>; numbers?: number[] }) { return <div className="orders-approved-measurement-grid">{numbers.map((number) => { const tone = [1, 2, 3, 15].includes(number) ? "is-required" : [6, 7, 8].includes(number) ? "is-sleeve" : ""; return <div className={tone || undefined} key={number}><small>№{number} · {measurementFieldLabels[number - 1]}</small><strong>{measurement.values?.[`m${number}`] == null ? "—" : `${formatCm(measurement.values[`m${number}`]!)} см`}</strong></div>; })}</div>; }

function TabIcon({ name }: { name: string }) { const paths: Record<string, ReactNode> = { details: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>, designs: <><rect x="4" y="5" width="13" height="15" rx="2" /><path d="M8 5V3h12v15h-3" /></>, measurements: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h5" /></>, client: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, finance: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>, production: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.5 6A8 8 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.5 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></>, delivery: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>, notes: <><path d="M4 20h16V4H4z" /><path d="M8 9h8m-8 4h8m-8 4h5" /></>, history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>, edit: <><path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" /></>, file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></> }; return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.details}</svg>; }

export function expandedOrderItems(order: ExpandedOrderView): ExpandedOrderItem[] {
  if (!order.items.length && order.compositionManaged) return [];
  if (order.items.length) return order.items.filter(item=>!item.archivedAt).map((item, index) => {
    const athlete = item.athlete || (order.items.length === 1 && index === 0 ? order.athlete as Athlete | undefined : undefined);
    const measurement = ownedMeasurement(item.measurement, athlete) || (order.items.length === 1 && index === 0 ? ownedMeasurement(order.measurement, athlete) : undefined);
    return { ...item, instances:item.instances?.filter(instance=>!instance.archivedAt), persistedItemId: item.id, athlete, measurement, measurementHistory: item.measurementHistory?.length ? item.measurementHistory : athlete?.measurements ?? (order.items.length === 1 ? order.measurementHistory : []) };
  });
  return [{ id: order.id, persistedItemId: undefined, name: order.notes || ui.item, quantity: 1, priceMinor: order.priceMinor, productionStatus: order.productionStatus, modelImagePath: order.modelImagePath, athlete: order.athlete as Athlete | undefined, measurement: ownedMeasurement(order.measurement, order.athlete as Athlete | undefined), measurementHistory: order.measurementHistory ?? [] }];
}

function paid(order: ExpandedOrderView) { return orderSettlement({ ...order, payments: order.paymentHistory ?? order.payments }).paidMinor; }
function balance(order: ExpandedOrderView) { return orderSettlement({ ...order, payments: order.paymentHistory ?? order.payments }).balanceMinor; }
function money(value: number | null, currency: string) { return value === null ? dataEvidenceUi.unavailable : moneyLabel(value,currency); }
function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatCm(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value); }
function formatFileSize(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} КБ` : `${(value / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`; }
export function itemQuantity(order: ExpandedOrderView) {
  const quantity = order.items.filter(item => !item.archivedAt).reduce((sum, item) => sum + item.quantity, 0);
  return quantity || (order.compositionManaged ? 0 : 1);
}
function itemImage(item: ExpandedOrderItem) { return item.modelImagePath ? `/api/orders/images/${item.modelImagePath}` : item.externalImageUrl || null; }
function athleteName(athlete: Athlete) { return [athlete.firstName, athlete.lastName].filter(Boolean).join(" "); }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru")).join("") || "—"; }
function ownedMeasurement(measurement: Order["measurement"], athlete?: Athlete) { return measurement && athlete && measurement.athleteId === athlete.id ? measurement : undefined; }
function latestMeasurement(athlete: Athlete) { return athlete.measurements?.length ? [...athlete.measurements].filter((measurement) => measurement.athleteId === athlete.id).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] : undefined; }
function uniqueAthletes(order: ExpandedOrderView, items: ExpandedOrderItem[]) { const values = [order.athlete as Athlete | undefined, ...items.flatMap((item) => [item.athlete, ...(item.instances ?? []).map((instance) => instance.athlete)])].filter((athlete): athlete is Athlete => Boolean(athlete)); return [...new Map(values.map((athlete) => [athlete.id, athlete])).values()]; }
function clientMeasurementOptions(order: ExpandedOrderView, item: ExpandedOrderItem) { return (order.client.athletes ?? []).filter((athlete) => !item.athlete || athlete.id === item.athlete.id).flatMap((athlete) => (athlete.measurements ?? []).map((measurement) => ({ value: measurement.id, label: `${athleteName(athlete)} · ${formatDate(measurement.measuredAt)}` }))); }
function deliveryRecipient(order: ExpandedOrderView) { return order.deliveryAddressSet ? order.deliveryRecipient || ui.notSpecified : order.client.displayName; }
function deliveryPlace(order: ExpandedOrderView) { if (!order.deliveryAddressSet) return [order.client.address, order.client.city, order.client.postalCode, order.country || order.client.country].filter(Boolean).join(", ") || ui.addressMissing; return order.deliveryAddressText || [order.deliveryAddressLine1, order.deliveryAddressLine2, order.deliveryCity, order.deliveryRegion, order.deliveryPostalCode, order.country].filter(Boolean).join(", ") || ui.addressMissing; }
function deliveryCountry(order: ExpandedOrderView) { return order.deliveryAddressSet ? order.country : order.country || order.client.country; }
function trackingNumber(order: ExpandedOrderView) { const shipments = order.orderShipments ?? []; return (shipments.find((shipment) => shipment.isPrimary)?.trackingNumber || shipments.find((shipment) => shipment.trackingNumber)?.trackingNumber || order.shipment?.trackingNumber || order.deliveryTrackingCode || "").trim(); }
function shipmentMethod(order: ExpandedOrderView) { const shipments = order.orderShipments ?? []; const shipment = shipments.find((candidate) => candidate.isPrimary) || shipments[0]; return shipment ? shipmentMethodLabel(shipment) : order.shipment?.carrier ? ((ui.carriers as Record<string, string>)[order.shipment.carrier] || order.shipment.carrier) : order.deliveryServiceName || ui.notSpecified; }
function shipmentMethodLabel(shipment: OrderShipmentView) { return shipment.serviceName || (ui.carriers as Record<string, string>)[shipment.carrier] || shipment.carrier; }
function minorInput(value: number) { return (value / 100).toFixed(2).replace(".", ","); }
function parseShipmentMinor(value: string) { const normalized = value.trim().replace(/\s/g, "").replace(",", "."); if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null; const parsed = Number(normalized); return Number.isFinite(parsed) ? Math.round(parsed * 100) : null; }
function optionalNumberInput(value?: number | null) { return value == null ? "" : String(value); }
function parseOptionalPositiveInteger(value: string): number | undefined | null { if (!value.trim()) return undefined; const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function dateInput(value?: string | null) { return value ? value.slice(0, 10) : ""; }
function dateTimeOrNull(value: string) { return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : null; }
function countryLabel(country?: string) { return country?.trim().replace(/^[A-Z]{2}\s+/i, "") || ""; }
function orderTypeLabel(value: string) { return (orderFormUi.types as Record<string, string>)[value] || value; }
function disciplineLabel(value?: string) { return (ui.disciplines as Record<string, string>)[value || ""] || ui.disciplines.missing; }
function paymentMethodLabel(value: string) { return ({ BANK_TRANSFER: ui.bankTransfer, CARD: ui.cardPayment, PAYPAL: "PayPal", CASH: ui.cashPayment, OTHER: ui.otherPayment } as Record<string, string>)[value] || value; }
function slotDateRange(order: ExpandedOrderView) { return order.productionSlot ? `${formatDate(order.productionSlot.startsAt)} — ${formatDate(order.productionSlot.endsAt)}` : ui.notSpecified; }
function displayInstanceNumber(items: ExpandedOrderItem[], item: ExpandedOrderItem, ordinal: number) { return `${Math.max(1, items.indexOf(item) + 1)}.${ordinal}`; }
function categoryLabel(category: string) { return (ui.noteCategoryLabels as Record<string, string>)[category] || category; }
function visibilityLabel(visibility: string) { return (ui.noteVisibilityLabels as Record<string, string>)[visibility] || visibility; }
function noteCategoryCounts(notes: NonNullable<ExpandedOrderView["notesStructured"]>) { const counts = new Map<string, number>(); for (const note of notes) counts.set(note.category, (counts.get(note.category) || 0) + 1); return [...counts.entries()]; }
function latestClientMeasurementDate(athletes: Athlete[]) { const values = athletes.flatMap((athlete) => athlete.measurements ?? []).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)); return values[0] ? formatDate(values[0].measuredAt) : ""; }
function productionPropertyLines(items: ExpandedOrderItem[], keys: string[]) { const values = items.flatMap((item) => { const properties = item.properties && typeof item.properties === "object" && !Array.isArray(item.properties) ? item.properties as Record<string, unknown> : {}; return keys.flatMap((key) => preferenceValue(properties[key]).split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean)); }); return [...new Set(values)]; }
function trackingUrl(order: ExpandedOrderView) { const tracking = trackingNumber(order); if (!tracking) return ""; const shipment = order.orderShipments?.find((candidate) => candidate.trackingNumber === tracking) || order.orderShipments?.[0]; const urls: Record<string, string> = { NOVA_POSHTA: `https://tracking.novaposhta.ua/#/uk?number=${encodeURIComponent(tracking)}`, NOVA_GLOBAL: `https://novaposhtaglobal.ua/track/?Tracking_ID=${encodeURIComponent(tracking)}`, UKRPOSHTA: `https://track.ukrposhta.ua/tracking_EN.html?barcode=${encodeURIComponent(tracking)}`, DHL: `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(tracking)}` }; return shipment ? urls[shipment.carrier] || "" : ""; }
function carrierLinks() { return [{ label: "Nova Global", href: "https://novaposhtaglobal.ua/track/" }, { label: "UPS", href: "https://www.ups.com/track" }, { label: "DHL", href: "https://www.dhl.com/global-en/home/tracking.html" }, { label: "La Poste", href: "https://www.laposte.fr/outils/suivre-vos-envois" }]; }
function activityTypeLabel(value: string) { const normalized = value.toLocaleUpperCase("en"); if (normalized.includes("PAYMENT")) return ui.activityPayments; if (normalized.includes("SHIP") || normalized.includes("DELIVER")) return ui.activityShipping; if (normalized.includes("PRODUCTION") || normalized.includes("SLOT")) return ui.activityProduction; if (normalized.includes("MEASUREMENT")) return ui.activityMeasurements; if (normalized.includes("NOTE")) return ui.activityNotes; if (normalized.includes("FILE")) return ui.activityFiles; if (normalized.includes("ORDER")) return ui.activityOrder; return ui.activityOther; }
function coarseProductionCode(value: string) { if (["ON_HOLD", "CANCELLED"].includes(value)) return value; if (value === "READY") return "READY"; if (["MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL"].includes(value)) return "SEWING"; if (["TENTATIVE", "SCHEDULED"].includes(value)) return "SCHEDULED"; return "NOT_SCHEDULED"; }
function coarseProductionLabel(value: string) { const code = coarseProductionCode(value) as keyof typeof ui.instanceProductionStatusLabels; return ui.instanceProductionStatusLabels[code]; }
function isInstanceOverdue(instance: OrderItemInstanceView) { return Boolean(instance.plannedEndAt && !["READY","CANCELLED","ON_HOLD"].includes(coarseProductionCode(instance.productionStatus)) && new Date(instance.plannedEndAt).getTime() < Date.now()); }
function preferenceEntries(preferences?: Record<string, unknown> | null): Array<[string, string]> { if (!preferences) return []; return Object.entries(preferences).flatMap(([key, value]) => { const rendered = preferenceValue(value); return rendered ? [[formatPreferenceLabel(key), rendered] as [string, string]] : []; }); }
function preferenceValue(value: unknown): string { if (typeof value === "string") return value.trim(); if (typeof value === "number" || typeof value === "boolean") return String(value); if (Array.isArray(value)) return value.map(preferenceValue).filter(Boolean).join(", "); return ""; }
function formatPreferenceLabel(value: string) { return value.replace(/([a-zа-я])([A-ZА-Я])/g, "$1 $2").replace(/[_-]+/g, " ").trim(); }
