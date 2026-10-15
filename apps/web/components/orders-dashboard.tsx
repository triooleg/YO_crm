"use client";
import {orderCostumeQuantity,orderAssignedAthleteCount,orderDesignCount,orderDesignImagePaths} from '../lib/order-composition-view';

import { orderSourceUi as sourceUi } from "../lib/i18n";
import { parseSource, sourceOptions, sourceLabel, type OrderSourceFilter } from "../lib/order-source";
import { OrderSourceBadge, CartIcon } from "./order-source-analytics";
import { moneyLabel } from "../lib/finance-report";
import { orderSettlement } from "../lib/order-settlement.mjs";
import { dataEvidenceUi } from "../lib/i18n";

import { QuickPayment } from "./order-payment-dialog";
import { SalesStatusSelect } from "./crm/sales-status-select";
import { CountrySelect } from "./crm/country-select";
import { findCountry } from "../lib/country-options.mjs";
import { CSSProperties, Fragment, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Select, Badge, Menu, Modal, Radio, UnstyledButton, useMantineTheme } from "@mantine/core";
import { orderFormUi, ordersDashboardUi as ui, productionUi, overviewContextUi } from "../lib/i18n";
import { orderLabel } from "../lib/orders-i18n";
import { migrateLegacyOrderColumnSettings, parseOrderColumnSettings } from "../lib/order-column-settings.mjs";
import { CrmAlert } from "./crm/alert";
import { CrmActionIcon, CrmButton, CrmCheckbox, CrmNativeSelect, CrmTextInput, CrmTextarea } from "./crm/settings-controls";
import { CrmSearchField } from "./crm/search-field";
import { CrmStatusBadge, crmStatusPresentation } from "./crm/status-badge";
import { canOpenOrderFinance } from "../lib/order-context";
import { orderDeadlineDays, orderReadyToShip, orderProductionStatusPresentation, orderTimelinePresentation, hasDatedProductionSlot } from "../lib/production-view";
import { orderMeasurementState } from "../lib/order-measurement-state";
import { ORDER_PAGE_SIZES, type OrderPageSize, paginateOrders, parseOrderPaginationState } from "../lib/order-pagination";
import { defaultOrderSort, nextOrderSort, sortOrders } from "../lib/order-sort.mjs";
import { orderDeliveryErrorMessage } from "../lib/order-delivery-errors";
import { hasUsableDeliveryAddress } from "../lib/order-delivery-address";
import { parseOrderPriceMinor } from "../lib/order-price";
import { MeasurementPanel } from "./measurement-panel";
import { AthleteMeasurementWizard } from "./athlete-measurement-wizard";
import { OrderPanel } from "./order-panel";
import { type Order } from "./orders-workspace";
import { expandedOrderItems, OrderExpandedTabs, type ExpandedOrderView, type OrderItemInstanceInput, type OrderNoteInput, type OrderShipmentInput } from "./orders/order-expanded-tabs";

type ColumnId = "client" | "model" | "quantity" | "deadline" | "payment" | "production" | "delivery" | "status" | "created" | "menu";
type SortColumnId = Exclude<ColumnId, "menu"> | "source";
type SortState = { column: SortColumnId; direction: "asc" | "desc" };
type QuickFilter = "all" | "active" | "urgent" | "deposit" | "depositShortfall" | "work" | "ready" | "completed" | "overdue";
type OrderListPage = {items:Order[];total:number;page:number;pageSize:number;focusFound:boolean;metrics:{total:number;active:number;unpaid:number;deposit:number;urgent:number;overdue:number;ready:number;completed:number;work:number};sources:{total:number;websiteCount:number};disciplines:string[]};

type OverviewContext = { filter: string; period: string };
type Props = { role: string; onNavigate: (section: "clients" | "inbox" | "production" | "finance", context?: Record<string, string>) => void };
type Preview = { src: string; left: number; top: number; width: number };
type OrderClientBrief = { id: string; displayName: string; country?: string };
type OrderClientDetail = OrderClientBrief & { athletes: { id: string; firstName: string; lastName?: string; measurements: { id: string; measuredAt: string }[] }[] };
type OrderDetail = ExpandedOrderView;
type MeasurementTarget = { orderId: string; itemId?: string };

const PAGINATION_SETTINGS_KEY = "orders-dashboard-pagination-v1";
const COLUMN_SETTINGS_KEY = "orders-dashboard-columns-v3";
const LEGACY_COLUMN_SETTINGS_KEY = "orders-dashboard-columns-v2";
const SORT_SETTINGS_KEY = "orders-dashboard-sort-v1";
const DEFAULT_COLUMNS: ColumnId[] = ["client", "model", "quantity", "deadline", "payment", "production", "delivery", "status", "created", "menu"];
const SORTABLE_ORDER_COLUMNS: SortColumnId[] = [...DEFAULT_COLUMNS.filter((id): id is Exclude<ColumnId,"menu"> => id !== "menu"),"source"];
const SALES_STATUSES = ["NEW_LEAD", "WAITING_CLIENT_REPLY", "NEEDS_ESTIMATE", "ESTIMATE_SENT", "DESIGN_DISCUSSION", "WAITING_COACH_APPROVAL", "WAITING_DEPOSIT", "DEPOSIT_RECEIVED", "ORDER_CONFIRMED", "MEASUREMENTS_REQUIRED", "MEASUREMENTS_RECEIVED", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "FINAL_DECORATION", "QUALITY_CONTROL", "PHOTO_SENT", "WAITING_FINAL_PAYMENT", "PAID", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "REVIEW_REQUESTED", "COMPLETED", "CANCELLED"];
const DISCIPLINES = ["RHYTHMIC_GYMNASTICS", "ACROBATIC_GYMNASTICS", "FIGURE_SKATING", "AEROBIC_GYMNASTICS", "BATON_TWIRLING_MAJORETTE", "OTHER"] as const;
const NON_PRODUCTION_ORDER_TYPES = new Set(["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);

export function OrdersDashboard({ role, onNavigate }: Props) {
  const theme = useMantineTheme();
  const editableTextColor = (theme.other.crmControls as { editableTextColor: string }).editableTextColor;
  const [source,setSource]=useState<OrderSourceFilter>('');
  const [serverPage,setServerPage]=useState<OrderListPage>();
  const restoringRoute=useRef(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [overviewContext, setOverviewContext] = useState<OverviewContext | null>();
  const [routeRevision, setRouteRevision] = useState(0);
  const listContext = useRef({ search, overviewContext, source });
  useEffect(() => {
    const readContext = () => {
      const params = new URLSearchParams(window.location.search);
      restoringRoute.current=true;
      setSource(parseSource(params.get('source')));setSearch(params.get('search')||'');
      const quick=params.get('quick');if(quick&&['all','active','urgent','deposit','depositShortfall','work','ready','completed','overdue'].includes(quick))setQuickFilter(quick as QuickFilter);else setQuickFilter('all');
      setStatusFilter(params.get('status')||'all');setDisciplineFilter(params.get('discipline')||'all');
      const sortValue=params.get('sort');if(sortValue&&SORTABLE_ORDER_COLUMNS.includes(sortValue as SortColumnId))setSort({column:sortValue as SortColumnId,direction:params.get('direction')==='asc'?'asc':'desc'});else setSort({column:'created',direction:'desc'});
      const requestedPage=Number(params.get('page'));setPage(Number.isInteger(requestedPage)&&requestedPage>0?requestedPage:1);
      const size=Number(params.get('pageSize'));setPageSize(ORDER_PAGE_SIZES.includes(size as OrderPageSize)?size as OrderPageSize:20);
      const filter = params.get("overviewFilter") || "";
      const period = params.get("period") || "";
      const next = filter || period ? { filter, period } : null;
      setOverviewContext(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      return params.get("orderId") || undefined;
    };
    readContext();
    const onHistory = () => {
      const orderId = readContext();
      if (orderId !== initialOrderId.current) setExpandedId(undefined);
      initialOrderId.current = orderId;
      cancelPreviousOrderNavigation(true);
      listSequence.current++;
      skipNavigationSearchReload.current = false;
      setRouteRevision(current => current + 1);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [sort, setSort] = useState<SortState>({ column: "created", direction: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<OrderPageSize>(20);
  const [paginationReady, setPaginationReady] = useState(false);
  listContext.current={search,overviewContext,source};
  const currentRead=useRef({quickFilter,statusFilter,disciplineFilter,sort,page,pageSize});currentRead.current={quickFilter,statusFilter,disciplineFilter,sort,page,pageSize};
  const previousListCriteria = useRef<string | undefined>(undefined);
  const criteriaPageReset=useRef(false);
  const [expandedId, setExpandedId] = useState<string>();
  const [navigationTarget,setNavigationTarget]=useState<string>();
  const navigationSequence=useRef(0);
  const previousOrderContext=useRef<OrderDetail | undefined>(undefined);
  const listSequence=useRef(0);
  const skipNavigationSearchReload=useRef(false);
  useEffect(()=>()=>{navigationSequence.current++;},[]);
  const [orderDetails, setOrderDetails] = useState<Record<string, OrderDetail>>({});
  const [detailPending, setDetailPending] = useState<Set<string>>(new Set());
  const [statusPending, setStatusPending] = useState<Set<string>>(new Set());
  const statusRequests = useRef(new Set<string>());
  const [paymentOrderId, setPaymentOrderId] = useState<string>();
  const [deliveryOrderId, setDeliveryOrderId] = useState<string>();
  const [deliveryContactOrderId, setDeliveryContactOrderId] = useState<string>();
  const [currencyOrderId, setCurrencyOrderId] = useState<string>();
  const [customerWishesOrderId, setCustomerWishesOrderId] = useState<string>();
  const [managerCommentOrderId, setManagerCommentOrderId] = useState<string>();
  const [clientEditOrderId, setClientEditOrderId] = useState<string>();
  const [addDesignOrderId, setAddDesignOrderId] = useState<string>();
  const [editOrderId, setEditOrderId] = useState<string>();
  const [editOrderClient, setEditOrderClient] = useState<OrderClientDetail>();
  const [editDesign, setEditDesign] = useState<{orderId:string;itemId:string}>();
  const paymentTrigger = useRef<HTMLButtonElement>(null);
  const [measurementTarget, setMeasurementTarget] = useState<MeasurementTarget>();
  const [addAthleteOrderId, setAddAthleteOrderId] = useState<string>();
  const addAthleteTrigger = useRef<HTMLButtonElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsTrigger = useRef<HTMLButtonElement>(null);
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set());
  const [draggedColumn, setDraggedColumn] = useState<ColumnId>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderClients, setNewOrderClients] = useState<OrderClientBrief[]>([]);
  const [newOrderClient, setNewOrderClient] = useState<OrderClientDetail>();
  const [newOrderLoading, setNewOrderLoading] = useState(false);
  const [newOrderQuery, setNewOrderQuery] = useState("");
  const newOrderTrigger = useRef<HTMLButtonElement>(null);
  const initialOrderId = useRef(typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("orderId") || undefined);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const localizedDeliveryError = orderDeliveryErrorMessage(body.code, { addressRequired: ui.deliveryAddressRequired, recipientRequired: ui.deliveryRecipientRequired, orderNotFound: ui.deliveryOrderNotFound });
      throw new Error(localizedDeliveryError ?? (Array.isArray(body.message) ? body.message.join(", ") : body.message ?? ui.error));
    }
    return response.json();
  }

  function orderListPath(query: string, context: OverviewContext | null | undefined, origin=listContext.current.source, overrides:Record<string,string>={}) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    if (context?.filter) params.set("overviewFilter", context.filter);
    if (context?.period) params.set("period", context.period);
    const state=currentRead.current;params.set('page',String(state.page));params.set('pageSize',String(state.pageSize));params.set('quick',state.quickFilter);params.set('status',state.statusFilter);params.set('discipline',state.disciplineFilter);params.set('sort',state.sort.column);params.set('direction',state.sort.direction);
    if(origin)params.set('source',origin);if(initialOrderId.current)params.set('focusId',initialOrderId.current);for(const [key,value] of Object.entries(overrides))params.set(key,value);
    return `/orders${params.size ? `?${params}` : ""}`;
  }

  function clearOverviewContext() {
    listSequence.current++;
    cancelPreviousOrderNavigation();
    skipNavigationSearchReload.current = false;
    previousOrderContext.current = undefined;
    setOverviewContext(null);
    setPage(1);
    const url = new URL(window.location.href);
    url.searchParams.delete("overviewFilter");
    url.searchParams.delete("period");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function load() {
    const { search: requestedSearch, overviewContext: context } = listContext.current;
    if (context === undefined || !paginationReady) return;
    const sequence=++listSequence.current;
    const path = orderListPath(requestedSearch, context);
    setLoading(true);
    try {
      const response = await request(path) as OrderListPage | Order[];
      const paged=Array.isArray(response)?undefined:response;const listed=Array.isArray(response)?response:response.items;
      let contextUnavailable = false;
      const contextOrder = initialOrderId.current
        ? await request(`/orders/${encodeURIComponent(initialOrderId.current)}`).catch(() => { contextUnavailable = true; return undefined; }) as OrderDetail | undefined
        : undefined;
      if(sequence!==listSequence.current || path !== orderListPath(listContext.current.search, listContext.current.overviewContext))return;
      if ((context || listContext.current.source || paged) && contextOrder && (paged? !paged.focusFound : !listed.some(order => order.id === contextOrder.id))) contextUnavailable = true;
      const retainedContext = contextUnavailable ? undefined : contextOrder ?? (!requestedSearch.trim() && !context ? previousOrderContext.current : undefined);
      setServerPage(paged);if(paged)setPage(paged.page);
      setOrders(!paged && retainedContext && !listed.some((order) => order.id === retainedContext.id) ? [retainedContext, ...listed] : listed);
      if (contextOrder && !contextUnavailable) {
        setOrderDetails((current) => ({ ...current, [contextOrder.id]: contextOrder }));
        setExpandedId(contextOrder.id);if(paged)setNavigationTarget(contextOrder.id);
      }
      if(paged)initialOrderId.current=undefined;
      setError(contextUnavailable ? overviewContextUi.orderUnavailable : "");
    } catch (reason) {
      if(sequence===listSequence.current && path === orderListPath(listContext.current.search, listContext.current.overviewContext))setError((reason as Error).message);
    } finally {
      if(sequence===listSequence.current)setLoading(false);
    }
  }

  async function refreshOrder(orderId: string, reconcileOverview = false) {
    const detail = await request(`/orders/${orderId}`) as OrderDetail;
    setOrderDetails((current) => ({ ...current, [orderId]: detail }));
    setOrders((items) => items.map((item) => item.id === orderId ? detail : item));
    if (reconcileOverview && (serverPage || listContext.current.overviewContext)) await load();
    return detail;
  }

  async function openPreviousOrder(orderId:string) {
    const sequence=++navigationSequence.current;
    try {
      const [detail,response]=await Promise.all([
        request(`/orders/${encodeURIComponent(orderId)}`) as Promise<OrderDetail>,
        request(orderListPath('',listContext.current.overviewContext,listContext.current.source,{page:'1',focusId:orderId,quick:'all',status:'all',discipline:'all'})) as Promise<OrderListPage|Order[]>,
      ]);
      if(sequence!==navigationSequence.current)return;
      const paged=Array.isArray(response)?undefined:response,listed=Array.isArray(response)?response:response.items;
      if((listContext.current.overviewContext||listContext.current.source||paged)&&!(paged?paged.focusFound:listed.some(order=>order.id===orderId))){setError(overviewContextUi.orderUnavailable);return;}
      listSequence.current++;setLoading(false);previousOrderContext.current=detail;initialOrderId.current=undefined;
      setOrderDetails(current=>({...current,[orderId]:detail}));setServerPage(paged);setOrders(listed.some(order=>order.id===orderId)?listed:[...listed,detail]);
      previousListCriteria.current=undefined;setQuickFilter('all');setStatusFilter('all');setDisciplineFilter('all');setSearch('');setError('');if(paged)setPage(paged.page);setExpandedId(orderId);
      setNavigationTarget(orderId);
      const url=new URL(window.location.href);url.searchParams.set('orderId',orderId);window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
    }catch(reason){if(sequence===navigationSequence.current)setError((reason as Error).message);}
  }

  function cancelPreviousOrderNavigation(keepRoute=false){navigationSequence.current++;setNavigationTarget(undefined);if(!keepRoute){initialOrderId.current=undefined;const url=new URL(window.location.href);url.searchParams.delete('orderId');window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);}}

  async function voidOrderPayment(orderId: string, paymentId: string, reason: string, expectedOrderUpdatedAt: string) {
    const result = await request(`/orders/${orderId}/payments/${paymentId}/void`, {method: "POST", body: JSON.stringify({reason, expectedOrderUpdatedAt})});
    const update = (current: OrderDetail) => ({...current, updatedAt: result.orderUpdatedAt, paymentStatus: result.paymentStatus, payments: current.payments.filter(payment => payment.id !== paymentId), paymentHistory: current.paymentHistory?.map(payment => payment.id === paymentId ? {...payment, voidedAt: result.payment.voidedAt, voidReason: result.payment.voidReason, canVoid: false} : payment)});
    setOrderDetails(current => current[orderId] ? {...current, [orderId]: update(current[orderId])} : current);
    setOrders(current => current.map(order => order.id === orderId ? update(order as OrderDetail) : order));
    try { await refreshOrder(orderId, true); } catch { setError(ui.paymentRefreshWarning); }
  }

  async function refreshAfterMutation(orderId: string) {
    try { return await refreshOrder(orderId, true); }
    catch {
      setOrderDetails((current) => { const next = { ...current }; delete next[orderId]; return next; });
      await load();
      return undefined;
    }
  }

  async function uploadOrderFile(orderId:string,file:File){
    const mimeType=file.type||(/\.ai$/i.test(file.name)?"application/illustrator":"");
    await request(`/orders/${orderId}/files`,{method:"POST",body:JSON.stringify({name:file.name,mimeType,data:await fileToData(file)})});
    await refreshAfterMutation(orderId);
  }

  async function bindOrderItemMeasurement(orderId:string,itemId:string,measurementId:string,expectedMeasurementId:string|null){
    try {
      await request(`/orders/${orderId}/items/${itemId}/measurement`,{method:"PATCH",body:JSON.stringify({measurementId,expectedMeasurementId})});
      await refreshAfterMutation(orderId);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function createOrderNote(orderId: string, input: OrderNoteInput) {
    await request(`/order-tabs/${orderId}/notes`, { method: "POST", body: JSON.stringify(input) });
    await refreshOrder(orderId);
  }

  async function updateOrderNote(orderId: string, noteId: string, input: OrderNoteInput & { expectedUpdatedAt: string }) {
    await request(`/order-tabs/${orderId}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(input) });
    await refreshOrder(orderId, true);
  }

  async function archiveOrderNote(orderId: string, noteId: string) {
    await request(`/order-tabs/${orderId}/notes/${noteId}`, { method: "DELETE" });
    await refreshOrder(orderId, true);
  }

  async function createOrderShipment(orderId: string, input: OrderShipmentInput) {
    await request(`/shipping/orders/${orderId}/shipments`, { method: "POST", body: JSON.stringify(input) });
    await refreshOrder(orderId, true);
  }

  async function updateOrderShipment(orderId: string, shipmentId: string, input: OrderShipmentInput) {
    await request(`/shipping/orders/${orderId}/shipments/${shipmentId}`, { method: "PUT", body: JSON.stringify(input) });
    await refreshOrder(orderId, true);
  }

  async function updateOrderItemInstance(orderId: string, instanceId: string, input: OrderItemInstanceInput) {
    await request(`/order-tabs/${orderId}/instances/${instanceId}`, { method: "PATCH", body: JSON.stringify(input) });
    await refreshOrder(orderId, true);
  }

  async function updateClientPreferences(orderId: string, clientId: string, preferences: Record<string, unknown>, expectedUpdatedAt: string | undefined) {
    await request(`/order-tabs/clients/${clientId}/preferences`, { method: "PATCH", body: JSON.stringify({ preferences, expectedUpdatedAt }) });
    await refreshOrder(orderId, true);
  }

  async function uploadClientFile(orderId: string, clientId: string, file: File) {
    await request(`/order-tabs/clients/${clientId}/files`, { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data: await fileToData(file) }) });
    await refreshOrder(orderId, true);
  }

  async function toggleExpanded(order: Order) {
    cancelPreviousOrderNavigation();
    if (expandedId === order.id) { setExpandedId(undefined); return; }
    setExpandedId(order.id);
    if (orderDetails[order.id] || detailPending.has(order.id)) return;
    setDetailPending((current) => new Set(current).add(order.id));
    try { await refreshOrder(order.id); setError(""); }
    catch (reason) { setError((reason as Error).message); }
    finally { setDetailPending((current) => { const next = new Set(current); next.delete(order.id); return next; }); }
  }

  useEffect(() => {
    if(skipNavigationSearchReload.current&&!search){skipNavigationSearchReload.current=false;return;}
    const timer = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timer);
  }, [search, overviewContext, source, quickFilter,statusFilter,disciplineFilter,sort,page,pageSize,paginationReady,routeRevision]);

  useEffect(() => {
    const saved = parseOrderColumnSettings(localStorage.getItem(COLUMN_SETTINGS_KEY), DEFAULT_COLUMNS)
      ?? migrateLegacyOrderColumnSettings(localStorage.getItem(LEGACY_COLUMN_SETTINGS_KEY), DEFAULT_COLUMNS);
    if (!saved) return;
    setColumnOrder(saved.order);
    setHiddenColumns(new Set(saved.hidden));
    localStorage.setItem(COLUMN_SETTINGS_KEY, JSON.stringify(saved));
  }, []);

  useEffect(() => {
    const saved = parseSavedOrderSort(localStorage.getItem(SORT_SETTINGS_KEY));
    if (saved&&!new URLSearchParams(window.location.search).has("sort")) setSort(saved);
  }, []);

  useEffect(() => {
    const saved = parseOrderPaginationState(sessionStorage.getItem(PAGINATION_SETTINGS_KEY));
    const params=new URLSearchParams(window.location.search);if(!params.has("page"))setPage(saved.page);
    if(!params.has("pageSize"))setPageSize(saved.pageSize);
    setPaginationReady(true);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") !== "new-order" || !["OWNER", "ADMIN", "MANAGER"].includes(role)) return;
    openNewOrder();
    url.searchParams.delete("action");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [role]);

  useEffect(() => {
    if (!paginationReady) return;
    const criteria = JSON.stringify([quickFilter, statusFilter, disciplineFilter, sort, search, overviewContext,source]);
    if (previousListCriteria.current === undefined || restoringRoute.current) {
      previousListCriteria.current = criteria;
      return;
    }
    if (previousListCriteria.current !== criteria) {
      previousListCriteria.current = criteria;
      if(page!==1){criteriaPageReset.current=true;setPage(1);}
    }
  }, [paginationReady, quickFilter, statusFilter, disciplineFilter, sort, search, overviewContext,source]);

  useEffect(() => {
    if (!paginationReady) return;
    sessionStorage.setItem(PAGINATION_SETTINGS_KEY, JSON.stringify({ page, pageSize }));
  }, [paginationReady, page, pageSize]);

  useEffect(()=>{
    if(!paginationReady||overviewContext===undefined)return;
    if(criteriaPageReset.current){criteriaPageReset.current=false;return;}
    const restore=restoringRoute.current;restoringRoute.current=false;
    const url=new URL(window.location.href),query=new URLSearchParams(orderListPath(search,overviewContext).split('?')[1]);query.delete('focusId');
    for(const key of ['source','search','quick','status','discipline','sort','direction','page','pageSize']){const value=query.get(key);if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
    const next=`${url.pathname}${url.search}${url.hash}`;if(next!==`${window.location.pathname}${window.location.search}${window.location.hash}`)window.history[restore?'replaceState':'pushState'](null,'',next);
  },[paginationReady,overviewContext,source,search,quickFilter,statusFilter,disciplineFilter,sort,page,pageSize]);

  useEffect(() => {
    if (!newOrderOpen) return;
    let cancelled = false;
    setNewOrderLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const query = newOrderQuery.trim();
        const clients = await request(`/clients${query ? `?search=${encodeURIComponent(query)}` : ""}`);
        if (!cancelled) { setNewOrderClients(clients); setError(""); }
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      } finally {
        if (!cancelled) setNewOrderLoading(false);
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [newOrderOpen, newOrderQuery]);

  const metrics = useMemo(() => serverPage?.metrics ?? ({
    total: orders.length,
    active: orders.filter(isActiveOrder).length,
    unpaid: orders.filter((order) => isActiveOrder(order) && paid(order) === 0).length,
    deposit: orders.filter((order) => isActiveOrder(order) && depositShortfall(order)).length,
    urgent: orders.filter((order) => isOperationalOrder(order) && days(order) >= 0 && days(order) <= 7).length,
    overdue: orders.filter((order) => isOperationalOrder(order) && days(order) < 0).length,
    ready: orders.filter(isReadyToShip).length,
    completed: orders.filter((order) => order.salesStatus === "COMPLETED").length,
  }), [orders,serverPage]);

  const disciplines = useMemo(() => serverPage?.disciplines ?? [...new Set(orders.map((order) => order.discipline).filter((value): value is string => Boolean(value)))].sort(), [orders,serverPage]);
  const filtered = useMemo(() => serverPage?orders:orders.filter((order) => {
    if (statusFilter === "active" && !isActiveOrder(order)) return false;
    if (statusFilter !== "all" && statusFilter !== "active" && order.salesStatus !== statusFilter) return false;
    if (disciplineFilter !== "all" && order.discipline !== disciplineFilter) return false;
    if (quickFilter === "active" && !isActiveOrder(order)) return false;
    if (quickFilter === "urgent" && !(isOperationalOrder(order) && days(order) >= 0 && days(order) <= 7)) return false;
    if (quickFilter === "deposit" && !(isActiveOrder(order) && paid(order) === 0)) return false;
    if (quickFilter === "depositShortfall" && !(isActiveOrder(order) && depositShortfall(order))) return false;
    if (quickFilter === "work" && !(isOperationalOrder(order) && ["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL"].includes(order.productionStatus))) return false;
    if (quickFilter === "ready" && !isReadyToShip(order)) return false;
    if (quickFilter === "completed" && order.salesStatus !== "COMPLETED") return false;
    if (quickFilter === "overdue" && !(isOperationalOrder(order) && days(order) < 0)) return false;
    return true;
  }), [orders, quickFilter, statusFilter, disciplineFilter,serverPage]);

  const sorted = useMemo<Order[]>(() => serverPage?filtered:sortOrders(filtered, sort, (order: Order, column: string) => {
    if (column === "model") return `${order.items[0]?.name || order.notes || ui.designMissing}|${discipline(order.discipline).label}`;
    if (column === "production") return `${order.productionSlot?.startsAt || ""}|${order.productionStatus}`;
    if (column === "status") return orderLabel("sales", order.salesStatus);
    if (column === "delivery") return `${countryLabel(deliveryCountry(order)) || ui.addressMissing}|${deliveryPlace(order)}|${orderLabel("shipping", order.shippingStatus)}`;
    return undefined;
  }), [filtered, sort,serverPage]);
  const orderPage = serverPage?{items:orders,page:serverPage.page,totalPages:Math.max(1,Math.ceil(serverPage.total/pageSize))}:paginateOrders(sorted, page, pageSize);
  const totalRows=serverPage?.total??sorted.length;
  const totalPages = orderPage.totalPages;
  const currentPage = orderPage.page;
  const shown = orderPage.items;
  useEffect(()=>{
    if(!navigationTarget)return;
    const index=sorted.findIndex(order=>order.id===navigationTarget);
    if(index<0)return;
    const targetPage=serverPage?serverPage.page:Math.floor(index/pageSize)+1;
    if(page!==targetPage){setPage(targetPage);return;}
    setExpandedId(navigationTarget);
    const frame=requestAnimationFrame(()=>{document.getElementById(`order-details-${navigationTarget}`)?.scrollIntoView({block:"center"});setNavigationTarget(undefined);});
    return()=>cancelAnimationFrame(frame);
  },[navigationTarget,sorted,pageSize,page]);
  const paymentOrder = orders.find((order) => order.id === paymentOrderId);
  const deliveryOrder = orders.find((order) => order.id === deliveryOrderId);
  const deliveryContactOrder = orders.find((order) => order.id === deliveryContactOrderId);
  const currencyChangeOrder = orders.find((order) => order.id === currencyOrderId);
  const customerWishesOrder = orders.find((order) => order.id === customerWishesOrderId);
  const managerCommentOrder = managerCommentOrderId ? orderDetails[managerCommentOrderId] ?? orders.find((order) => order.id === managerCommentOrderId) : undefined;
  const clientEditOrder = orders.find((order) => order.id === clientEditOrderId);
  const addDesignOrder = orders.find((order) => order.id === addDesignOrderId);
  const editOrder = orders.find((order) => order.id === editOrderId);
  const editDesignOrder = orders.find((order) => order.id === editDesign?.orderId);
  const editDesignItem = editDesignOrder?.items.find((item) => item.id === editDesign?.itemId);
  const visibleColumns = columnOrder.filter((id) => !hiddenColumns.has(id));
  const filterCount = Number(statusFilter !== "all") + Number(disciplineFilter !== "all")+Number(Boolean(source));
  const canArchiveOrders = role === "OWNER" || role === "ADMIN";

  useEffect(() => {
    if (!serverPage && paginationReady && !loading && page !== currentPage) setPage(currentPage);
  }, [serverPage,paginationReady, loading, page, currentPage]);

  useEffect(() => {
    const contextOrderId = initialOrderId.current;
    if (!paginationReady || loading || !contextOrderId) return;
    const targetIndex = sorted.findIndex((order) => order.id === contextOrderId);
    if (targetIndex < 0) return;
    const targetPage = serverPage?serverPage.page:Math.floor(targetIndex / pageSize) + 1;
    if (page !== targetPage) { setPage(targetPage); return; }
    setExpandedId(contextOrderId);
    requestAnimationFrame(() => document.getElementById(`order-details-${contextOrderId}`)?.scrollIntoView({ block: "center" }));
  }, [paginationReady, loading, sorted, pageSize, page]);

  function persistColumns(order: ColumnId[], hidden: Set<ColumnId>) {
    setColumnOrder(order);
    setHiddenColumns(hidden);
    localStorage.setItem(COLUMN_SETTINGS_KEY, JSON.stringify({ order, hidden: [...hidden] }));
  }
  function moveColumn(id: ColumnId, delta: number) {
    const current = columnOrder.indexOf(id), target = Math.max(0, Math.min(columnOrder.length - 1, current + delta));
    if (current === target) return;
    const next = [...columnOrder]; next.splice(current, 1); next.splice(target, 0, id); persistColumns(next, hiddenColumns);
  }
  function dropColumn(target: ColumnId) {
    if (!draggedColumn || draggedColumn === target) return;
    const next = [...columnOrder], current = next.indexOf(draggedColumn), targetIndex = next.indexOf(target);
    next.splice(current, 1); next.splice(targetIndex, 0, draggedColumn); setDraggedColumn(undefined); persistColumns(next, hiddenColumns);
  }
  function toggleColumn(id: ColumnId) {
    const next = new Set(hiddenColumns); next.has(id) ? next.delete(id) : next.add(id); persistColumns(columnOrder, next);
  }
  function selectQuickFilter(filter: QuickFilter) { cancelPreviousOrderNavigation();setQuickFilter((current) => current === filter && filter !== "all" ? "all" : filter); }
  function clearFilters() { setSource('');cancelPreviousOrderNavigation();setQuickFilter("all"); setStatusFilter("all"); setDisciplineFilter("all"); }
  function changePage(next:number){initialOrderId.current=undefined;cancelPreviousOrderNavigation();setPage(next);}
  function persistSort(next: SortState) { cancelPreviousOrderNavigation();setSort(next); localStorage.setItem(SORT_SETTINGS_KEY, JSON.stringify(next)); }
  function cycleSort(id: SortColumnId) { cancelPreviousOrderNavigation();setSort((current) => { const next = nextOrderSort(current, id) as SortState; localStorage.setItem(SORT_SETTINGS_KEY, JSON.stringify(next)); return next; }); }
  function changePageSize(value: string) {
    cancelPreviousOrderNavigation();
    const next = Number(value) as OrderPageSize;
    if (!ORDER_PAGE_SIZES.includes(next)) return;
    setPageSize(next);
    setPage(1);
  }
  async function changeStatus(order: Order, field: "salesStatus" | "productionStatus", value: string) {
    if (statusRequests.current.has(order.id)) return;
    const previous = order[field];
    statusRequests.current.add(order.id);
    setStatusPending((current) => new Set(current).add(order.id));
    const applyLocalStatus = (nextValue: string) => {
      setOrders((items) => items.map((item) => item.id === order.id ? { ...item, [field]: nextValue } : item));
      setOrderDetails((current) => {
        const detail = current[order.id];
        return detail ? { ...current, [order.id]: { ...detail, [field]: nextValue } as OrderDetail } : current;
      });
    };
    applyLocalStatus(value);
    try {
      const updated = await request(`/orders/${order.id}/statuses`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }) as Partial<Order>;
      applyLocalStatus(String(updated[field] ?? value));
    }
    catch (reason) {
      applyLocalStatus(previous);
      setError((reason as Error).message);
      statusRequests.current.delete(order.id);
      setStatusPending((current) => { const next = new Set(current); next.delete(order.id); return next; });
      return;
    }
    try { await refreshOrder(order.id, true); setError(""); }
    catch (reason) { setError((reason as Error).message); }
    finally { statusRequests.current.delete(order.id); setStatusPending((current) => { const next = new Set(current); next.delete(order.id); return next; }); }
  }
  async function changeDeadline(order: Order, value: string) {
    if (!value) return;
    try { await request(`/orders/${order.id}/deadline`, { method: "PATCH", body: JSON.stringify({ requiredDeliveryAt: value }) }); await refreshAfterMutation(order.id); }
    catch (reason) { setError((reason as Error).message); }
  }
  async function changeDiscipline(order: Order, value: string) {
    if (value === order.discipline || !DISCIPLINES.includes(value as (typeof DISCIPLINES)[number])) return;
    const previous=order.discipline;
    setOrders(items=>items.map(item=>item.id===order.id?{...item,discipline:value}:item));
    try{await request(`/orders/${order.id}/discipline`,{method:"PATCH",body:JSON.stringify({discipline:value})});await refreshAfterMutation(order.id)}
    catch(reason){setOrders(items=>items.map(item=>item.id===order.id?{...item,discipline:previous}:item));setError((reason as Error).message)}
  }
  async function changeOrderImage(order: Order, itemId: string | undefined, expectedModelImagePath: string | null, file: File) {
    try {
      const data = await fileToData(file);
      const image = await request("/orders/model-image", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, data }) }) as { path: string };
      await request(`/orders/${order.id}/model-image`, { method: "PATCH", body: JSON.stringify({ itemId, modelImagePath: image.path, expectedModelImagePath }) });
      await refreshAfterMutation(order.id);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function showPreview(event: ReactMouseEvent<HTMLImageElement>) {
    const image = event.currentTarget, width = Math.min(520, window.innerWidth - 24), left = event.clientX + width + 24 < window.innerWidth ? event.clientX + 16 : Math.max(12, event.clientX - width - 16), top = 12;
    setPreview({ src: image.src, left, top, width });
  }
  async function exportOrders() {
    let exported=sorted;
    try{if(serverPage){exported=[];for(let p=1;;p++){const result=await request(orderListPath(search,overviewContext,source,{page:String(p),pageSize:'100',focusId:''})) as OrderListPage;exported.push(...result.items);if(exported.length>=result.total||!result.items.length)break;}}}catch(reason){setError((reason as Error).message);return;}
    const rows = [[...ui.csvHeaders,sourceUi.filter], ...exported.map((order) => [order.number, order.client.displayName, String(itemQuantity(order)), discipline(order.discipline).label, deliveryDate(order), String(order.priceMinor), paid(order) == null ? "" : String(paid(order)), balance(order) == null ? "" : String(balance(order)), orderLabel("sales", order.salesStatus), deliveryPlace(order), orderProblems(order).join("; "),sourceLabel(order.orderSource)])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  function openNewOrder() {
    setNewOrderOpen(true);
    setNewOrderQuery("");
    setNewOrderClients([]);
    setNewOrderLoading(true);
    setError("");
  }
  async function selectNewOrderClient(clientId: string) {
    setNewOrderLoading(true);
    setError("");
    try { setNewOrderClient(await request(`/clients/${clientId}`)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setNewOrderLoading(false); }
  }
  function closeNewOrder() { setNewOrderOpen(false); setNewOrderClient(undefined); window.requestAnimationFrame(() => newOrderTrigger.current?.focus()); }
  async function openEditOrder(order: Order) {
    setEditOrderId(order.id); setEditOrderClient(undefined); setError("");
    try { setEditOrderClient(await request(`/clients/${order.client.id}`)); }
    catch (reason) { setEditOrderId(undefined); setError((reason as Error).message); }
  }
  function closeEditOrder() { setEditOrderId(undefined); setEditOrderClient(undefined); }
  function closePayment() { setPaymentOrderId(undefined); window.requestAnimationFrame(() => paymentTrigger.current?.focus()); }
  async function archiveSelectedOrders() {
    if (!selectedIds.size || archiving) return;
    setArchiving(true);
    try {
      await request("/orders/archive", { method: "PATCH", body: JSON.stringify({ orderIds: [...selectedIds] }) });
      setArchiveOpen(false);
      setSelectedIds(new Set());
      setExpandedId((current) => current && selectedIds.has(current) ? undefined : current);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setArchiving(false);
    }
  }

  return <section className="phase2-main orders-page orders-dashboard" style={{ "--od-editable": editableTextColor } as CSSProperties}>
    <header className="phase2-header orders-dashboard-header">
      <div><p>{ui.eyebrow}</p><h1>{ui.title}</h1><span>{ui.subtitle}</span></div>
      <CrmButton ref={newOrderTrigger} className="orders-new-order" onClick={() => openNewOrder()}>{ui.newOrder} <span aria-hidden="true">⌄</span></CrmButton>
    </header>
    {error && <CrmAlert className="orders-error" onClose={() => setError("")}>{error}<CrmButton tone="secondary" size="compact-sm" onClick={() => void load()}>{ui.retry}</CrmButton></CrmAlert>}
    {overviewContext && <div className="orders-overview-context" role="status"><span><strong>{overviewContextUi.filter}</strong> {overviewContextUi.filters[overviewContext.filter as keyof typeof overviewContextUi.filters] || overviewContextUi.filters.period}{overviewContext.period && <> · {overviewContext.period}</>}</span><CrmButton tone="secondary" size="compact-sm" onClick={clearOverviewContext}>{overviewContextUi.clear}</CrmButton></div>}

    <div className="orders-kpi-grid">
      <Kpi label={ui.kpis.all} value={loading || error ? null : metrics.total} icon="bag" active={quickFilter === "all"} onClick={() => selectQuickFilter("all")} />
      {serverPage&&<button className={`orders-kpi tone-green${source==='WEBSITE'?' active':''}`} aria-pressed={source==='WEBSITE'} title={sourceUi.ordersScope} onClick={()=>{cancelPreviousOrderNavigation();setSource(source==='WEBSITE'?'':'WEBSITE');}}><i><CartIcon/></i><span><small>{sourceUi.onlineOrders}</small><strong>{loading||error?'—':serverPage.sources.websiteCount}</strong></span></button>}
      <Kpi label={ui.kpis.deposit} value={loading || error ? null : metrics.deposit} icon="payment" tone="amber" active={quickFilter === "depositShortfall"} onClick={() => selectQuickFilter("depositShortfall")} />
      <Kpi label={ui.kpis.urgent} value={loading || error ? null : metrics.urgent} icon="calendar" tone="red" active={quickFilter === "urgent"} onClick={() => selectQuickFilter("urgent")} />
      <Kpi label={ui.kpis.overdue} value={loading || error ? null : metrics.overdue} icon="clock" tone="red" active={quickFilter === "overdue"} onClick={() => selectQuickFilter("overdue")} />
      <Kpi label={ui.kpis.ready} value={loading || error ? null : metrics.ready} icon="truck" tone="green" active={quickFilter === "ready"} onClick={() => selectQuickFilter("ready")} />
      <Kpi label={ui.kpis.completed} value={loading || error ? null : metrics.completed} icon="check" tone="gray" active={quickFilter === "completed"} onClick={() => selectQuickFilter("completed")} />
    </div>

    <div className="orders-command-bar">
      <CrmSearchField className="orders-search" value={search} onValueChange={value=>{cancelPreviousOrderNavigation();setSearch(value);}} placeholder={ui.search} ariaLabel={ui.search} clearLabel={ui.clearSearch} showSearchIcon />
      <div className="orders-filter-wrap">
        <CrmButton tone="secondary" className={`orders-filter-trigger${filterOpen ? " active" : ""}`} onClick={() => setFilterOpen((value) => !value)}><UiIcon name="filter" />{ui.filters}{filterCount > 0 && <b>{filterCount}</b>}</CrmButton>
        {filterOpen && <div className="orders-filter-popover" role="dialog" aria-label={ui.filters}>
          <Select label={sourceUi.filter} value={source} onChange={value=>{cancelPreviousOrderNavigation();setSource(parseSource(value));}} data={sourceOptions()} allowDeselect={false}/>
          <CrmNativeSelect label={ui.filterStatus} value={statusFilter} onChange={(event) => {cancelPreviousOrderNavigation();setStatusFilter(event.target.value);}} data={[{ value: "all", label: ui.allStatuses }, { value: "active", label: ui.kpis.active }, ...SALES_STATUSES.map((status) => ({ value: status, label: orderLabel("sales", status) }))]} />
          <CrmNativeSelect label={ui.discipline} value={disciplineFilter} onChange={(event) => {cancelPreviousOrderNavigation();setDisciplineFilter(event.target.value);}} data={[{ value: "all", label: ui.anyDiscipline }, ...disciplines.map((value) => ({ value, label: discipline(value).label }))]} />
          <CrmButton tone="secondary" onClick={clearFilters}>{ui.clearAll}</CrmButton>
        </div>}
      </div>
      <div className="orders-quick-filters">{([ ["all", ui.all, metrics.total], ["urgent", ui.urgent, metrics.urgent], ["deposit", ui.withoutDeposit, metrics.unpaid], ["work", ui.inWork, (serverPage?.metrics.work??orders.filter((order) => isOperationalOrder(order) && ["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL"].includes(order.productionStatus)).length)], ["ready", ui.ready, metrics.ready] ] as const).map(([id, label, value]) => <button key={id} className={quickFilter === id ? "active" : ""} onClick={() => selectQuickFilter(id)}>{label}<small>{loading || error ? "—" : value}</small></button>)}</div>
      <CrmNativeSelect className="orders-sort" label={ui.sortLabel} value={sort.column} onChange={(event) => persistSort(defaultOrderSort(event.target.value) as SortState)} data={SORTABLE_ORDER_COLUMNS.map((id) => ({ value: id, label: id === "source" ? sourceUi.filter : ui.columnsMap[id] }))} />
      <CrmButton ref={columnsTrigger} tone="secondary" className="orders-columns-button" onClick={() => setColumnsOpen(true)}><UiIcon name="settings" />{ui.columns}</CrmButton>
      <CrmActionIcon className="orders-export" onClick={exportOrders} aria-label={ui.export}><UiIcon name="download" /></CrmActionIcon>
    </div>

    {(source || quickFilter !== "all" || statusFilter !== "all" || disciplineFilter !== "all") && <div className="orders-filter-chips">
      {source&&<FilterChip label={`${sourceUi.filter}: ${sourceLabel(source)}`} onRemove={()=>setSource('')}/>}
      {quickFilter !== "all" && <FilterChip label={quickFilterLabel(quickFilter)} onRemove={() => setQuickFilter("all")} />}
      {statusFilter !== "all" && <FilterChip label={statusFilter === "active" ? ui.activeStatus : `${ui.statusPrefix}: ${orderLabel("sales", statusFilter)}`} onRemove={() => {cancelPreviousOrderNavigation();setStatusFilter("all");}} />}
      {disciplineFilter !== "all" && <FilterChip label={`${ui.discipline}: ${discipline(disciplineFilter).label}`} onRemove={() => {cancelPreviousOrderNavigation();setDisciplineFilter("all");}} />}
      <button className="orders-clear-filters" onClick={clearFilters}>{ui.clearAll}</button>
    </div>}

    {selectedIds.size > 0 && <div className="orders-selection"><strong>{ui.selected}: {selectedIds.size}</strong><span>{ui.bulkHint}</span>{canArchiveOrders && <CrmButton color="red" size="compact-sm" onClick={() => setArchiveOpen(true)}>{ui.archiveSelected}</CrmButton>}<button className="orders-clear-selection" onClick={() => setSelectedIds(new Set())}>{ui.clearSelection}</button></div>}

    <div className="orders-table-wrap orders-table-scroll">
      <table className="orders-table orders-dashboard-table">
        <colgroup><col className="orders-controls" />{visibleColumns.map((id) => <col key={id} className={`orders-col orders-col-${id}`} />)}</colgroup>
        <thead><tr><th className="orders-controls"><input type="checkbox" aria-label={ui.selectAll} checked={shown.length > 0 && shown.every((order) => selectedIds.has(order.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(shown.map((order) => order.id)) : new Set())} /></th>{visibleColumns.map((id) => id === "menu" ? <th key={id} className={`orders-col orders-col-${id}`} style={{ order: columnOrder.indexOf(id) + 1 }}>{ui.columnsMap[id]}</th> : <th key={id} className={`orders-col orders-col-${id}`} style={{ order: columnOrder.indexOf(id) + 1 }} aria-sort={sort.column === id ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button className="orders-sort-heading" onClick={() => cycleSort(id)} aria-label={`${ui.sortByColumn}: ${ui.columnsMap[id]}`} title={`${ui.sortByColumn}: ${ui.columnsMap[id]}`}><span>{ui.columnsMap[id]}</span><b aria-hidden="true">{sort.column === id ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</b></button></th>)}</tr></thead>
        <tbody>
          {loading && <tr className="orders-state-row"><td colSpan={visibleColumns.length + 1}><span className="orders-loader" />{ui.loading}</td></tr>}
          {!loading && !error && !shown.length && <tr className="orders-state-row"><td colSpan={visibleColumns.length + 1}><strong>{ui.empty}</strong><small>{ui.emptyHint}</small>{(source || quickFilter !== "all" || statusFilter !== "all" || disciplineFilter !== "all") && <button onClick={clearFilters}>{ui.clearAll}</button>}</td></tr>}
          {!loading && shown.map((order) => <Fragment key={order.id}>
            <tr data-sales-status={order.salesStatus} style={{"--order-status-color":theme.colors[crmStatusPresentation("sales",order.salesStatus).color]![6]} as CSSProperties} className={`orders-summary-row${expandedId === order.id ? " is-expanded" : ""}`}>
              <td className="orders-controls"><button className="orders-expand" aria-label={expandedId === order.id ? ui.collapse : ui.expand} aria-expanded={expandedId === order.id} aria-controls={`order-details-${order.id}`} onClick={() => void toggleExpanded(order)}><UiIcon name={expandedId === order.id ? "chevronDown" : "chevronRight"} /></button><input type="checkbox" aria-label={ui.selectOrder} checked={selectedIds.has(order.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(order.id) : next.delete(order.id); return next; })} /></td>
              {visibleColumns.map((id) => <OrderCell key={id} id={id} order={order} columnOrder={columnOrder} expanded={expandedId === order.id} detailsId={`order-details-${order.id}`} statusPending={statusPending.has(order.id)} onStatus={(current, value) => void changeStatus(current, "salesStatus", value)} onDeadline={changeDeadline} onDiscipline={changeDiscipline} onPreview={showPreview} onPreviewLeave={() => setPreview(undefined)} onExpand={() => void toggleExpanded(order)} onClient={() => onNavigate("clients", { clientId: order.client.id, orderId: order.id })} onProduction={() => onNavigate("production", { orderId: order.id })} onDelivery={() => setDeliveryOrderId(order.id)} />)}
            </tr>
            {expandedId === order.id && <tr className="orders-expanded-row"><td colSpan={visibleColumns.length + 1}><div id={`order-details-${order.id}`} role="region" aria-label={`${ui.orderDetails} ${order.number}`}>{detailPending.has(order.id) && <span className="orders-detail-loading">{ui.loading}</span>}<ExpandedOrder onOpenOrder={id=>void openPreviousOrder(id)} expenseActions={canOpenOrderFinance(role)?{request,onSaved:()=>refreshAfterMutation(order.id).then(()=>undefined)}:undefined} financeActions={["OWNER", "ADMIN", "MANAGER"].includes(role) ? { request, onSaved: () => refreshAfterMutation(order.id).then(() => undefined) } : undefined} onVoidPayment={["OWNER", "ADMIN", "ACCOUNTANT"].includes(role) ? (paymentId, reason, expectedOrderUpdatedAt) => voidOrderPayment(order.id, paymentId, reason, expectedOrderUpdatedAt) : undefined} measurementActions={["OWNER", "ADMIN", "MANAGER"].includes(role) ? { request, onSaved: () => refreshAfterMutation(order.id).then(() => undefined) } : undefined} order={orderDetails[order.id] ?? order} paymentTrigger={paymentTrigger} addAthleteButtonRef={addAthleteTrigger} statusPending={statusPending.has(order.id)} onStatus={(field, value) => void changeStatus(orderDetails[order.id] ?? order, field, value)} onClient={() => onNavigate("clients", { clientId: order.client.id, orderId: order.id })} onEditClient={() => setClientEditOrderId(order.id)} onConversation={() => onNavigate("inbox", { clientId: order.client.id, clientName: order.client.displayName, orderId: order.id })} onProduction={() => onNavigate("production", { orderId: order.id })} onFinance={canOpenOrderFinance(role) ? () => onNavigate("finance", { orderId: order.id }) : undefined} onPayment={() => setPaymentOrderId(order.id)} onDelivery={() => setDeliveryOrderId(order.id)} onDeliveryContact={() => setDeliveryContactOrderId(order.id)} onMeasurements={(itemId) => setMeasurementTarget({ orderId: order.id, itemId })} onAddAthlete={["OWNER", "ADMIN", "MANAGER"].includes(role) ? () => setAddAthleteOrderId(order.id) : undefined} onBindMeasurement={(itemId,measurementId,expectedMeasurementId)=>bindOrderItemMeasurement(order.id,itemId,measurementId,expectedMeasurementId)} onCurrency={() => setCurrencyOrderId(order.id)} onManagerComment={() => setManagerCommentOrderId(order.id)} onCustomerWishes={() => setCustomerWishesOrderId(order.id)} onEdit={() => void openEditOrder(order)} onAddDesign={()=>setAddDesignOrderId(order.id)} onEditItem={(itemId) => setEditDesign({ orderId: order.id, itemId })} onUploadFile={(file)=>uploadOrderFile(order.id,file)} onImage={(itemId, expectedModelImagePath, file) => changeOrderImage(order, itemId, expectedModelImagePath, file)} onCreateNote={(input) => createOrderNote(order.id, input)} onUpdateNote={(noteId, input) => updateOrderNote(order.id, noteId, input)} onArchiveNote={["OWNER", "ADMIN", "MANAGER"].includes(role) ? (noteId) => archiveOrderNote(order.id, noteId) : undefined} onCreateShipment={(input) => createOrderShipment(order.id, input)} onUpdateShipment={(shipmentId, input) => updateOrderShipment(order.id, shipmentId, input)} onUpdateInstance={(instanceId, input) => updateOrderItemInstance(order.id, instanceId, input)} onUpdateClientPreferences={(preferences) => updateClientPreferences(order.id, order.client.id, preferences, (orderDetails[order.id] ?? order).client.updatedAt)} onUploadClientFile={(file) => uploadClientFile(order.id, order.client.id, file)} /></div></td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>

    {!loading && totalRows > 0 && <div className="orders-pagination"><span>{ui.shown} {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalRows)} {ui.of} {totalRows}</span><nav aria-label={ui.pagination}><button disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><UiIcon name="chevronLeft" /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).slice(Math.max(0, currentPage - 3), Math.max(5, currentPage + 2)).map((value) => <button key={value} className={currentPage === value ? "active" : ""} aria-current={currentPage === value ? "page" : undefined} onClick={() => changePage(value)}>{value}</button>)}<button disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}><UiIcon name="chevronRight" /></button></nav><CrmNativeSelect className="orders-page-size" aria-label={ui.ordersPerPage} value={String(pageSize)} onChange={(event) => changePageSize(event.target.value)} data={ORDER_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / ${ui.rowsPerPage}` }))} /></div>}

    <Modal opened={columnsOpen} onClose={() => setColumnsOpen(false)} title={ui.columns} aria-label={ui.columns} closeButtonProps={{ "aria-label": ui.close }} returnFocus centered size={440} classNames={{ content: "orders-column-settings", header: "orders-column-settings-header", title: "orders-column-settings-title", body: "orders-column-settings-body" }}>
      <p className="orders-columns-hint">{ui.columnsHint}</p>
      <div className="orders-columns-list">{columnOrder.map((id, index) => <div key={id} data-column-id={id} draggable onDragStart={() => setDraggedColumn(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropColumn(id)}><span aria-hidden="true">⋮⋮</span><CrmCheckbox data-autofocus={index === 0 || undefined} checked={!hiddenColumns.has(id)} onChange={() => toggleColumn(id)} label={ui.columnsMap[id]} /><CrmActionIcon disabled={index === 0} onClick={() => moveColumn(id, -1)} aria-label={ui.moveUp}>↑</CrmActionIcon><CrmActionIcon disabled={index === columnOrder.length - 1} onClick={() => moveColumn(id, 1)} aria-label={ui.moveDown}>↓</CrmActionIcon></div>)}</div>
      <footer className="orders-column-settings-footer"><CrmButton tone="secondary" onClick={() => persistColumns(DEFAULT_COLUMNS, new Set())}>{ui.reset}</CrmButton><CrmButton onClick={() => setColumnsOpen(false)}>{ui.done}</CrmButton></footer>
    </Modal>
    <Modal opened={archiveOpen} onClose={() => !archiving && setArchiveOpen(false)} title={ui.archiveOrdersTitle} aria-label={ui.archiveOrdersTitle} closeButtonProps={{ "aria-label": ui.close, disabled: archiving }} closeOnClickOutside={!archiving} closeOnEscape={!archiving} returnFocus centered size={460}>
      <p className="orders-archive-hint">{ui.archiveOrdersHint}</p>
      <p><strong>{ui.selected}: {selectedIds.size}</strong></p>
      <div className="orders-archive-actions"><CrmButton tone="secondary" disabled={archiving} onClick={() => setArchiveOpen(false)}>{ui.archiveOrdersCancel}</CrmButton><CrmButton color="red" loading={archiving} onClick={() => void archiveSelectedOrders()}>{archiving ? ui.archiving : ui.archiveOrdersConfirm}</CrmButton></div>
    </Modal>
    {preview && <img className="orders-image-preview" src={preview.src} alt={ui.enlargedModel} style={{ left: preview.left, top: preview.top, width: preview.width }} />}
    {newOrderOpen && !newOrderClient && <OrderClientPicker clients={newOrderClients} loading={newOrderLoading} query={newOrderQuery} onQuery={setNewOrderQuery} onSelect={(id) => void selectNewOrderClient(id)} onClose={closeNewOrder} />}
    {newOrderClient && <OrderPanel client={newOrderClient} request={request} onClose={closeNewOrder} onSaved={async () => { closeNewOrder(); await load(); }} />}
    {paymentOrder && <QuickPayment order={paymentOrder} request={request} onClose={closePayment} onSaved={async () => { closePayment(); await refreshAfterMutation(paymentOrder.id); }} />}
    {deliveryOrder && <DeliveryAddressModal order={deliveryOrder} request={request} onClose={() => setDeliveryOrderId(undefined)} onSaved={async () => { setDeliveryOrderId(undefined); await refreshAfterMutation(deliveryOrder.id); }} />}
    {deliveryContactOrder && <DeliveryContactModal order={deliveryContactOrder} request={request} onClose={() => setDeliveryContactOrderId(undefined)} onSaved={async () => { const orderId = deliveryContactOrder.id; setDeliveryContactOrderId(undefined); await refreshAfterMutation(orderId); }} />}
    {currencyChangeOrder && <CurrencyChangeModal order={currencyChangeOrder} request={request} onClose={() => setCurrencyOrderId(undefined)} onSaved={async () => { setCurrencyOrderId(undefined); await refreshAfterMutation(currencyChangeOrder.id); }} />}
    {managerCommentOrder && <CustomerWishesModal kind="manager" order={managerCommentOrder} request={request} onClose={() => setManagerCommentOrderId(undefined)} onSaved={async () => { const orderId = managerCommentOrder.id; setManagerCommentOrderId(undefined); await refreshAfterMutation(orderId); }} />}
    {customerWishesOrder && <CustomerWishesModal order={customerWishesOrder} request={request} onClose={() => setCustomerWishesOrderId(undefined)} onSaved={async () => { const orderId = customerWishesOrder.id; setCustomerWishesOrderId(undefined); await refreshAfterMutation(orderId); }} />}
    {clientEditOrder && <ClientEditModal order={orderDetails[clientEditOrder.id]??clientEditOrder} request={request} onClose={()=>setClientEditOrderId(undefined)} onSaved={async()=>{const orderId=clientEditOrder.id;setClientEditOrderId(undefined);await refreshAfterMutation(orderId)}}/>}
    {addDesignOrder && <OrderDesignAddModal order={orderDetails[addDesignOrder.id]??addDesignOrder} request={request} onClose={()=>setAddDesignOrderId(undefined)} onSaved={async()=>{const orderId=addDesignOrder.id;setAddDesignOrderId(undefined);await refreshAfterMutation(orderId)}}/>}
    {editOrder && editOrderClient && <OrderPanel client={editOrderClient} order={editOrder} request={request} onClose={closeEditOrder} onSaved={async () => { closeEditOrder(); await refreshAfterMutation(editOrder.id); }} />}
    {editDesignOrder && editDesignItem && <OrderDesignEditModal order={editDesignOrder} item={editDesignItem} request={request} onClose={()=>setEditDesign(undefined)} onSaved={async()=>{const orderId=editDesignOrder.id;setEditDesign(undefined);await refreshAfterMutation(orderId)}}/>}
    {addAthleteOrderId && (() => { const order = orderDetails[addAthleteOrderId] ?? orders.find((item) => item.id === addAthleteOrderId); if (!order) return null; return <AthleteMeasurementWizard clientId={order.client.id} clientName={order.client.displayName} request={request} returnFocusRef={addAthleteTrigger} onClose={() => setAddAthleteOrderId(undefined)} onSaved={async () => { setAddAthleteOrderId(undefined); await refreshOrder(order.id); }} />; })()}
    {measurementTarget && (() => { const order = orderDetails[measurementTarget.orderId] ?? orders.find((item) => item.id === measurementTarget.orderId); const item = measurementTarget.itemId ? order?.items.find((entry) => entry.id === measurementTarget.itemId) : undefined; const athlete = item?.athlete ?? (order ? measurementAthlete(order) : undefined); const measurement = item?.measurement ?? (order ? primaryMeasurement(order) : undefined); return order && athlete ? <MeasurementPanel client={{ id: order.client.id, displayName: order.client.displayName, athletes: [athlete] }} request={request} orderId={order.id} orderItemId={item?.id} initialValues={measurement?.values} expectedMeasurementId={measurement?.id} title={measurement ? ui.editMeasurements : ui.addMeasurements} onClose={() => setMeasurementTarget(undefined)} onSaved={async () => { setMeasurementTarget(undefined); await refreshOrder(order.id); }} /> : null; })()}
  </section>;
}

function OrderDisciplineMenu({ order, onChange }: { order: Order; onChange: (order: Order, value: string) => void }) {
  const currentLabel = discipline(order.discipline).label;
  return <Menu width={220} position="bottom-start" shadow="md">
    <Menu.Target>
      <UnstyledButton className="orders-discipline-trigger" aria-label={`${ui.discipline}: ${currentLabel}, ${order.number}`}>
        {currentLabel}
      </UnstyledButton>
    </Menu.Target>
    <Menu.Dropdown>
      {DISCIPLINES.map((value) => { const selected = order.discipline === value; const label = discipline(value).label; return <Menu.Item key={value} aria-current={selected ? "true" : undefined} aria-label={selected ? `${label}, ${ui.selected}` : label} disabled={selected} onClick={() => void onChange(order, value)}>{label}</Menu.Item>; })}
    </Menu.Dropdown>
  </Menu>;
}

function OrderCell({ id, order, columnOrder, expanded, detailsId, statusPending, onStatus, onDeadline, onDiscipline, onPreview, onPreviewLeave, onExpand, onClient, onProduction, onDelivery }: { id: ColumnId; order: Order; columnOrder: ColumnId[]; expanded: boolean; detailsId: string; statusPending: boolean; onStatus: (order: Order, value: string) => void; onDeadline: (order: Order, value: string) => void; onDiscipline: (order: Order, value: string) => void; onPreview: (event: ReactMouseEvent<HTMLImageElement>) => void; onPreviewLeave: () => void; onExpand: () => void; onClient: () => void; onProduction: () => void; onDelivery: () => void }) {
  const style = { order: columnOrder.indexOf(id) + 1 } as CSSProperties;
  if (id === "client") return <td className="orders-col orders-col-client" style={style}><div className="orders-client-cell"><button className="orders-order-number" onClick={onExpand} aria-expanded={expanded} aria-controls={detailsId}>{order.number}</button>{order.orderSource==='WEBSITE' ? <span className="orders-channel website" role="img" aria-label={sourceLabel('WEBSITE')} title={sourceLabel('WEBSITE')}><CartIcon/></span> : <OrderChannelIcon channel={order.client.source} />}<button onClick={onClient} title={order.client.displayName}><strong>{order.client.displayName}</strong><small title={countryLabel(order.client.country) || ui.countryMissing}><CountryFlag country={order.client.country} />{countryLabel(order.client.country) || ui.countryMissing}</small></button></div></td>;
  if (id === "model") { const modelName = order.items[0]?.name || order.notes || ui.designMissing; return <td className="orders-col orders-col-model" style={style}><div className="orders-model-sport-cell"><OrderDesigns order={order} onPreview={onPreview} onLeave={onPreviewLeave} /><div><strong title={modelName}>{modelName}</strong><OrderDisciplineMenu order={order} onChange={onDiscipline} />{designCount(order) > 1 && <em>+{designCount(order) - 1}</em>}</div></div></td>; }
  if (id === "quantity") return <td className="orders-col orders-col-quantity" style={style}><strong>{quantitySummary(order)}</strong><small>{order.type === "GROUP_ORDER" ? `${athleteCount(order)} ${ui.groupsAthletes}` : order.type === "PAIR" ? ui.pair : ui.individualShort}</small></td>;
  if (id === "deadline") {const openPicker=(target:HTMLLabelElement)=>{const input=target.querySelector("input");if(typeof input?.showPicker==="function")input.showPicker();else input?.focus()};return <td className={`orders-col orders-col-deadline ${days(order) < 0 ? "orders-danger" : days(order) <= 7 ? "orders-warning" : ""}`} style={style}><label className="orders-deadline-button" role="button" tabIndex={0} onClick={event=>openPicker(event.currentTarget)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openPicker(event.currentTarget)}}}><strong>{deliveryDate(order)}</strong><small>{dayText(order)}</small><input tabIndex={-1} type="date" value={order.requiredDeliveryAt?.slice(0, 10) || ""} onChange={(event) => void onDeadline(order, event.target.value)} aria-label={ui.changeDeadline} /></label></td>}
  if (id === "payment") { const received = paid(order), percent = received === null ? null : order.priceMinor > 0 ? Math.min(100, Math.round(received / order.priceMinor * 100)) : 0; return <td className="orders-col orders-col-payment" style={style}><strong>{money(received, order.currency)} / {money(order.priceMinor, order.currency)}</strong><div className="orders-payment-progress" aria-label={percent === null ? dataEvidenceUi.unavailable : `${percent}%`}><i style={{ width: `${percent ?? 0}%` }} /></div><small className={hasBalance(order) ? "orders-balance-line" : "orders-paid-line"}>{balance(order) === null ? dataEvidenceUi.unavailable : hasBalance(order) ? `${ui.balancePrefix} ${money(balance(order), order.currency)}` : ui.paid}</small><em>{percent === null ? dataEvidenceUi.unavailable : `${percent}%`}</em></td>; }
  if (id === "production") {
    if(order.salesStatus==='COMPLETED') return <td className="orders-col orders-col-production" style={style}>{hasDatedProductionSlot(order)&&<strong>{slotDateRange(order)}</strong>}<Badge component="span" color="green" variant="light" radius="xl" size="sm">{productionUi.productionFulfilled}</Badge></td>;
    const presentation = orderProductionStatusPresentation(order);
    const shippingLabels: Record<string, string> = { SHIPPED: productionUi.shippingShipped, DELIVERED: productionUi.shippingDelivered, RETURNED: productionUi.shippingReturned, LOST: productionUi.shippingLost };
    const badge = presentation.domain === "shipping" ? <Badge component="span" className="crm-status-badge" color={crmStatusPresentation("shipping", presentation.status).color} data-domain="shipping" data-status={presentation.status} radius="xl" size="sm" variant="light">{shippingLabels[presentation.status]}</Badge> : <CrmStatusBadge {...presentation}/>;
    return <td className="orders-col orders-col-production" style={style}>{hasDatedProductionSlot(order) ? <><strong>{slotDateRange(order)}</strong>{badge}</> : <>{presentation.domain === "shipping" ? badge : order.orderSource!=='WEBSITE' && <small>{ui.notSpecified}</small>}{order.orderSource==='WEBSITE' ? <small className="orders-website-sale">{sourceUi.websiteSale}</small> : !NON_PRODUCTION_ORDER_TYPES.has(order.type) && <button className="orders-assign-production" title={ui.scheduleProduction} onClick={onProduction}>{ui.scheduleProduction}</button>}</>}</td>;
  }
  if (id === "status") return <td className="orders-col orders-col-status" style={style}><SalesStatusSelect disabled={statusPending} value={order.salesStatus} statuses={SALES_STATUSES} onChange={value => void onStatus(order,value)} /></td>;
  if (id === "delivery") { const shipped = orderHasShippedDelivery(order), tracking = orderTrackingNumber(order); return <td className="orders-col orders-col-delivery" style={style}><UnstyledButton className={shipped ? "orders-delivery-cell-button is-shipped" : "orders-delivery-cell-button"} onClick={onDelivery} aria-label={`${ui.editDeliveryAddress}: ${order.number}`}><strong><CountryFlag country={deliveryCountry(order)} />{countryLabel(deliveryCountry(order)) || ui.addressMissing}</strong>{shipped ? <small>{tracking || ui.trackingMissing}</small> : <><small>{deliveryPlace(order)}</small><small>{[order.shipment?.carrier ? carrierLabel(order.shipment.carrier) : order.deliveryServiceName, orderLabel("shipping", order.shippingStatus)].filter(Boolean).join(" · ")}</small>{tracking && <small>{tracking}</small>}</>}</UnstyledButton></td>; }
  if (id === "created") return <td className="orders-col orders-col-created" style={style}><strong>{date(order.createdAt)}</strong><small>{ageText(order.createdAt)}</small></td>;
  return <td className="orders-col orders-col-menu" style={style}><button className="orders-menu-button" onClick={onExpand} aria-label={expanded ? ui.collapse : ui.expand} title={expanded ? ui.collapse : ui.expand} aria-expanded={expanded} aria-controls={detailsId}>•••</button></td>;
}

function ExpandedOrder({ onOpenOrder, expenseActions, financeActions, onVoidPayment, measurementActions, order, paymentTrigger, addAthleteButtonRef, statusPending, onStatus, onClient, onEditClient, onConversation, onProduction, onFinance, onPayment, onDelivery, onDeliveryContact, onMeasurements, onAddAthlete, onBindMeasurement, onCurrency, onCustomerWishes, onManagerComment, onEdit, onAddDesign, onEditItem, onUploadFile, onImage, onCreateNote, onUpdateNote, onArchiveNote, onCreateShipment, onUpdateShipment, onUpdateInstance, onUpdateClientPreferences, onUploadClientFile }: { onOpenOrder:(id:string)=>void; expenseActions?:{request:(path:string,init?:RequestInit)=>Promise<any>;onSaved:()=>Promise<void>}; financeActions?: { request: (path: string, init?: RequestInit) => Promise<any>; onSaved: () => Promise<void> }; onVoidPayment?: (paymentId: string, reason: string, expectedOrderUpdatedAt: string) => Promise<void>; measurementActions?: { request: (path: string, init?: RequestInit) => Promise<any>; onSaved: () => Promise<void> }; order: OrderDetail; paymentTrigger: React.RefObject<HTMLButtonElement | null>; addAthleteButtonRef: React.RefObject<HTMLButtonElement | null>; statusPending: boolean; onStatus: (field: "salesStatus" | "productionStatus", value: string) => void; onClient: () => void; onEditClient:()=>void; onConversation: () => void; onProduction: () => void; onFinance?: () => void; onPayment: () => void; onDelivery: () => void; onDeliveryContact: () => void; onMeasurements: (itemId?: string) => void; onAddAthlete?: () => void; onBindMeasurement:(itemId:string,measurementId:string,expectedMeasurementId:string|null)=>Promise<void>; onCurrency: () => void; onCustomerWishes: () => void; onManagerComment: () => void; onEdit: () => void; onAddDesign:()=>void; onEditItem: (itemId:string)=>void; onUploadFile:(file:File)=>Promise<void>; onImage: (itemId: string | undefined, expectedModelImagePath: string | null, file: File) => Promise<void>; onCreateNote:(input:OrderNoteInput)=>Promise<void>; onUpdateNote:(noteId:string,input:OrderNoteInput&{expectedUpdatedAt:string})=>Promise<void>; onArchiveNote?:(noteId:string)=>Promise<void>; onCreateShipment:(input:OrderShipmentInput)=>Promise<void>; onUpdateShipment:(shipmentId:string,input:OrderShipmentInput)=>Promise<void>; onUpdateInstance:(instanceId:string,input:OrderItemInstanceInput)=>Promise<void>; onUpdateClientPreferences:(preferences:Record<string,unknown>)=>Promise<void>; onUploadClientFile:(file:File)=>Promise<void> }) {
  const flowRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const flow=flowRef.current;if(!flow)return;
    const captions=[...flow.querySelectorAll<HTMLElement>(".orders-flow-caption")];
    const update=()=>flow.style.setProperty("--flow-caption-height",`${Math.max(100,...captions.map(caption=>caption.offsetHeight+12))}px`);
    const observer=new ResizeObserver(update);captions.forEach(caption=>observer.observe(caption));update();
    return()=>observer.disconnect();
  },[]);
  const items = expandedOrderItems(order);
  const primaryImage = designPaths(order)[0];
  const problems = orderProblems(order);
  const paidMinor = paid(order);
  const paymentPercent = paidMinor === null ? null : order.priceMinor > 0 ? Math.min(100, Math.round(paidMinor / order.priceMinor * 100)) : 0;
  const requiresProduction = order.salesStatus !== 'COMPLETED' && !NON_PRODUCTION_ORDER_TYPES.has(order.type);
  const timeline = orderTimelinePresentation(order);
  const shippingLabel = timeline.partial ? `${ui.shippingPartial}${["LOST","RETURNED"].includes(timeline.shippingStatus) ? ` · ${orderLabel("shipping",timeline.shippingStatus)}` : ""}` : timeline.shippingStatus === "SHIPPED" ? ui.shippingSent : orderLabel("shipping", timeline.shippingStatus);
  return <div className="orders-approved-expanded">
    <section className="orders-order-overview">
      <div className="orders-order-identity">
        {primaryImage ? <img src={primaryImage} alt={ui.orderDesignAlt} /> : <span className="orders-order-identity-placeholder"><UiIcon name="image" /></span>}
        <div><p>{ui.selectedOrder}</p><h2>{order.number}{problems.length > 0 && <span>{ui.overviewWarning}</span>}</h2><OrderSourceBadge source={order.orderSource}/><strong title={order.client.displayName}><CountryFlag country={order.client.country} />{order.client.displayName}</strong><small>{countryLabel(order.client.country) || ui.countryMissing}</small><small><OrderChannelIcon channel={order.client.source} />{orderLabel("source", order.client.source)}</small><em title={items[0]?.name || order.notes || ui.designMissing}>{items[0]?.name || order.notes || ui.designMissing} · {itemQuantity(order)} {ui.pieces}</em>{requiresProduction && <CrmButton size="compact-sm" onClick={onProduction}>{ui.openInProduction} →</CrmButton>}</div>
      </div>
      <div ref={flowRef} className="orders-order-flow" aria-label={`${ui.payment} → ${ui.tabs.production} → ${ui.shipping}`}>
        <article className={paidMinor !== null && paidMinor >= order.depositRequiredMinor ? "complete" : "warning"}><i><UiIcon name="check" /></i><div className="orders-flow-caption"><b>{ui.payment}</b><CrmStatusBadge domain="payment" status={order.paymentStatus}/><strong>{money(paidMinor, order.currency)} / {money(order.priceMinor, order.currency)}</strong><small>{paymentPercent === null ? dataEvidenceUi.unavailable : `${paymentPercent}%`} · {ui.balancePrefix} {money(balance(order), order.currency)}</small></div></article>
        <article className={timeline.productionCompleted ? "complete" : "active"}><i><UiIcon name="settings" /></i><div className="orders-flow-caption"><b>{ui.tabs.production}</b>{timeline.productionCompleted ? <CrmStatusBadge domain="production" status="READY" label={ui.productionFulfilled}/> : <CrmStatusBadge domain="production" status={timeline.productionStatus}/>}<small>{order.productionSlot ? slotDateRange(order) : ui.notSpecified}{order.productionSlot?.tentative && !timeline.productionCompleted ? ` · ${ui.slotTentative}` : ""}</small></div></article>
        <article className={!timeline.partial && ["SHIPPED","DELIVERED"].includes(timeline.shippingStatus) ? "complete" : undefined}><i><UiIcon name="truck" /></i><div className="orders-flow-caption"><b>{ui.shipping}</b><CrmStatusBadge domain="shipping" status={timeline.shippingStatus} label={shippingLabel}/><small>{timeline.shippedAt ? `${ui.actualShipping}: ${date(timeline.shippedAt)}` : timeline.trackingNumber ? `${ui.shippingConfirmedByTracking}: ${timeline.trackingNumber}` : timeline.productionCompleted ? ui.shippingDateUnknown : `${ui.actualShipping}: ${ui.notSpecifiedFeminine}`}</small></div></article>
      </div>
      <div className="orders-order-deadlines"><h3>{ui.deadlines}</h3><Detail label={ui.readinessDeadline} value={deliveryDate(order)} /><Detail label={ui.productionStart} value={order.productionSlot ? date(order.productionSlot.startsAt) : ui.notSpecified} /><Detail label={ui.productionEnd} value={order.productionSlot ? date(order.productionSlot.endsAt) : ui.notSpecified} /><Detail label={ui.plannedShipping} value={ui.notSpecifiedFeminine} /><Detail label={ui.daysRemaining} value={dayText(order)} /><Detail label={ui.statusPrefix} value={<CrmStatusBadge domain="sales" status={order.salesStatus}/>} /></div>
      <div className="orders-order-actions"><h3>{ui.quickActions}</h3><CrmButton ref={paymentTrigger} tone="secondary" size="compact-sm" onClick={onPayment}><UiIcon name="payment" />{ui.addPayment}</CrmButton>{requiresProduction && <CrmButton tone="secondary" size="compact-sm" onClick={onProduction}><UiIcon name="calendar" />{ui.scheduleProduction}</CrmButton>}<CrmButton tone="secondary" size="compact-sm" onClick={onConversation}><UiIcon name="chat" />{ui.openConversation}</CrmButton><CrmButton tone="secondary" size="compact-sm" aria-label={ui.editOrder} onClick={onEdit}><UiIcon name="edit" />{ui.moreActions}</CrmButton></div>
    </section>
    <OrderExpandedTabs onOpenOrder={onOpenOrder} expenseActions={expenseActions} financeActions={financeActions} onVoidPayment={onVoidPayment} measurementActions={measurementActions} order={order} statusPending={statusPending} onProductionStatus={(value) => onStatus("productionStatus", value)} onClient={onClient} onEditClient={onEditClient} onFinance={onFinance} onPayment={onPayment} onProduction={onProduction} onDelivery={onDelivery} onDeliveryContact={onDeliveryContact} onMeasurements={onMeasurements} onAddAthlete={onAddAthlete} addAthleteButtonRef={addAthleteButtonRef} onBindMeasurement={onBindMeasurement} onCurrency={onCurrency} onCustomerWishes={onCustomerWishes} onManagerComment={onManagerComment} onEdit={onEdit} onAddDesign={onAddDesign} onEditItem={onEditItem} onUploadFile={onUploadFile} onImage={onImage} onCreateNote={onCreateNote} onUpdateNote={onUpdateNote} onArchiveNote={onArchiveNote} onCreateShipment={onCreateShipment} onUpdateShipment={onUpdateShipment} onUpdateInstance={onUpdateInstance} onUpdateClientPreferences={onUpdateClientPreferences} onUploadClientFile={onUploadClientFile} />
  </div>;
}

function ClientEditModal({order,request,onClose,onSaved}:{order:OrderDetail;request:(path:string,init?:RequestInit)=>Promise<unknown>;onClose:()=>void;onSaved:()=>Promise<void>}){
  const[name,setName]=useState(order.client.displayName),[country,setCountry]=useState(order.client.country||""),[language,setLanguage]=useState(order.client.language||""),[phone,setPhone]=useState(order.client.phone||""),[email,setEmail]=useState(order.client.email||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError("");try{await request(`/clients/${order.client.id}`,{method:"PATCH",body:JSON.stringify({displayName:name.trim(),country:country.trim()||null,language:language.trim()||null,phone:phone.trim()||null,email:email.trim()||null,expectedUpdatedAt:order.client.updatedAt})});await onSaved()}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  return <Modal opened onClose={onClose} title={ui.editClientTitle} aria-label={ui.editClientTitle} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{"aria-label":ui.close}} centered size="lg"><form className="orders-client-edit-form" onSubmit={submit}><CrmTextInput data-autofocus highlighted required label={ui.clientName} value={name} onChange={event=>setName(event.currentTarget.value)}/><div><CountrySelect value={country} onChange={setCountry} disabled={busy}/><CrmTextInput highlighted label={ui.language} value={language} onChange={event=>setLanguage(event.currentTarget.value)}/><CrmTextInput highlighted label={ui.phone} value={phone} onChange={event=>setPhone(event.currentTarget.value)}/><CrmTextInput highlighted type="email" label={ui.email} value={email} onChange={event=>setEmail(event.currentTarget.value)}/></div>{error&&<CrmAlert onClose={()=>setError("")}>{error}</CrmAlert>}<footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.saveClient}</CrmButton></footer></form></Modal>;
}

function OrderDesignAddModal({order,request,onClose,onSaved}:{order:OrderDetail;request:(path:string,init?:RequestInit)=>Promise<unknown>;onClose:()=>void;onSaved:()=>Promise<void>}){
  const athletes=order.client.athletes??uniqueOrderAthletes(order),input=useRef<HTMLInputElement>(null),[name,setName]=useState(""),[quantity,setQuantity]=useState("1"),[price,setPrice]=useState(""),[designNumber,setDesignNumber]=useState(""),[athleteId,setAthleteId]=useState(athletes.length===1?athletes[0]!.id:""),[file,setFile]=useState<File>(),[preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  function selectFile(next?:File){if(preview)URL.revokeObjectURL(preview);setFile(next);setPreview(next?URL.createObjectURL(next):"")}
  async function submit(event:React.FormEvent){event.preventDefault();const priceMinor=parseOrderPriceMinor(price),nextQuantity=Number(quantity),nextDesignNumber=designNumber.trim()?Number(designNumber):null;if(!name.trim()||priceMinor==null||!Number.isInteger(nextQuantity)||nextQuantity<1||(athletes.length>1&&!athleteId)||(nextDesignNumber!==null&&(!Number.isInteger(nextDesignNumber)||nextDesignNumber<1))){setError(ui.designValuesInvalid);return}setBusy(true);setError("");try{let modelImagePath:string|undefined;if(file){const uploaded=await request("/orders/model-image",{method:"POST",body:JSON.stringify({name:file.name,mime:file.type,data:await fileToData(file)})}) as {path:string};modelImagePath=uploaded.path}await request(`/orders/${order.id}/items`,{method:"POST",body:JSON.stringify({name:name.trim(),quantity:nextQuantity,priceMinor,designNumber:nextDesignNumber,...(athleteId?{athleteId}:{}),...(modelImagePath?{modelImagePath}:{})})});await onSaved()}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  return <Modal opened onClose={onClose} title={`${ui.addDesignTitle}: ${order.number}`} aria-label={ui.addDesignTitle} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{"aria-label":ui.close}} centered size="lg"><form className="orders-design-edit-form" onSubmit={submit}><div className="orders-edit-image">{preview?<img src={preview} alt={name}/>:<span><UiIcon name="image"/></span>}<input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>selectFile(event.currentTarget.files?.[0])}/><CrmButton type="button" tone="secondary" onClick={()=>input.current?.click()}>{ui.changeOrderImage}</CrmButton></div><CrmTextInput data-autofocus highlighted label={ui.designDescription} value={name} onChange={event=>setName(event.currentTarget.value)} required/>{athletes.length>0&&<CrmNativeSelect label={orderFormUi.selectAthlete} value={athleteId} onChange={event=>setAthleteId(event.target.value)} data={[...(athletes.length>1?[{value:"",label:orderFormUi.selectAthlete}]:[]),...athletes.map(athlete=>({value:athlete.id,label:[athlete.firstName,athlete.lastName].filter(Boolean).join(" ")}))]}/>}<CrmTextInput highlighted label={ui.illustratorDesignNumber} type="number" min={1} step={1} value={designNumber} onChange={event=>setDesignNumber(event.currentTarget.value)}/><div className="orders-design-edit-grid"><CrmTextInput highlighted label={ui.quantity} type="number" min={1} value={quantity} onChange={event=>setQuantity(event.currentTarget.value)} required/><CrmTextInput highlighted label={`${ui.unitPrice}, ${order.currency}`} inputMode="decimal" value={price} onChange={event=>setPrice(event.currentTarget.value)} required/></div>{error&&<CrmAlert onClose={()=>setError("")}>{error}</CrmAlert>}<footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.createDesign}</CrmButton></footer></form></Modal>;
}

function uniqueOrderAthletes(order:Order){const values=[order.athlete,...order.items.map(item=>item.athlete)].filter((athlete):athlete is NonNullable<Order["athlete"]>=>Boolean(athlete));return [...new Map(values.map(athlete=>[athlete.id,athlete])).values()]}

function fileToData(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }

function OrderDesignEditModal({order,item,request,onClose,onSaved}:{order:Order;item:Order["items"][number];request:(path:string,init?:RequestInit)=>Promise<unknown>;onClose:()=>void;onSaved:()=>Promise<void>}){
  const[name,setName]=useState(item.name),[quantity,setQuantity]=useState(String(item.quantity)),[price,setPrice]=useState((item.priceMinor/100).toFixed(2)),[designNumber,setDesignNumber]=useState(item.designNumber ? String(item.designNumber) : ""),[file,setFile]=useState<File>(),[filePreview,setFilePreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null),image=itemImage(item);
  useEffect(()=>{if(!file){setFilePreview("");return}const url=URL.createObjectURL(file);setFilePreview(url);return()=>URL.revokeObjectURL(url)},[file]);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const priceMinor=parseOrderPriceMinor(price),nextQuantity=Number(quantity),nextDesignNumber=designNumber.trim()?Number(designNumber):null;if(!name.trim()){setError(ui.designNameRequired);return}if(priceMinor==null||!Number.isInteger(nextQuantity)||nextQuantity<1||(nextDesignNumber!==null&&(!Number.isInteger(nextDesignNumber)||nextDesignNumber<1))){setError(ui.designValuesInvalid);return}setBusy(true);setError("");try{let modelImagePath:string|undefined;if(file){const data=await fileToData(file);const uploaded=await request("/orders/model-image",{method:"POST",body:JSON.stringify({name:file.name,mime:file.type,data})}) as {path:string};modelImagePath=uploaded.path}await request(`/orders/${order.id}/items/${item.id}`,{method:"PATCH",body:JSON.stringify({name:name.trim(),quantity:nextQuantity,priceMinor,designNumber:nextDesignNumber,expectedName:item.name,expectedQuantity:item.quantity,expectedPriceMinor:item.priceMinor,expectedDesignNumber:item.designNumber??null,expectedModelImagePath:item.modelImagePath??null,...(modelImagePath?{modelImagePath}:{})})});await onSaved()}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  return <Modal opened onClose={onClose} title={`${ui.editDesign}: ${order.number}`} aria-label={ui.editDesign} closeButtonProps={{"aria-label":ui.close}} closeOnEscape={!busy} closeOnClickOutside={!busy} returnFocus centered size="lg"><form className="orders-design-edit-form" onSubmit={submit}><div className="orders-edit-image">{filePreview?<img src={filePreview} alt={name}/>:image?<img src={image} alt={name}/>:<span><UiIcon name="image"/></span>}<input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>setFile(event.currentTarget.files?.[0])}/><CrmButton type="button" tone="secondary" onClick={()=>input.current?.click()}>{ui.changeOrderImage}</CrmButton></div><CrmTextInput data-autofocus highlighted label={ui.designDescription} value={name} onChange={event=>setName(event.currentTarget.value)} required/><CrmTextInput highlighted label={ui.illustratorDesignNumber} type="number" min={1} step={1} value={designNumber} onChange={event=>setDesignNumber(event.currentTarget.value)} placeholder={ui.illustratorDesignNumberPlaceholder}/><div className="orders-design-edit-grid"><CrmTextInput highlighted label={ui.quantity} type="number" min={1} max={1000} value={quantity} onChange={event=>setQuantity(event.currentTarget.value)} required/><CrmTextInput highlighted label={`${ui.unitPrice}, ${order.currency}`} inputMode="decimal" value={price} onChange={event=>setPrice(event.currentTarget.value)} required/></div><p className="orders-edit-hint">{ui.designTotalRecalculationHint}</p>{error&&<CrmAlert onClose={()=>setError("")}>{error}</CrmAlert>}<footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.saveDesign}</CrmButton></footer></form></Modal>
}

function ownedMeasurement(measurement: Order["measurement"], athlete: Order["athlete"]) { return measurement && athlete && measurement.athleteId === athlete.id ? measurement : undefined; }
function slotDateRange(order: Order) { return order.productionSlot ? `${shortDate(order.productionSlot.startsAt)} – ${shortDate(order.productionSlot.endsAt)}` : ui.notSpecified; }
function shortDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(value)).replace(".", ""); }

type ExchangeRateStatus = { provider: "ECB" | "NBU"; officialUrl: string; supportedPairs: readonly string[]; cache: null | { effectiveDate: string; fetchedAt: string } };

function CustomerWishesModal({ order, kind = "buyer", request, onClose, onSaved }: { kind?: "buyer" | "manager"; order: Order; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const manager = kind === "manager";
  const title = manager ? ui.editManagerComment : ui.editCustomerWishes;
  const [value, setValue] = useState((manager ? order.managerComment : order.buyerComment) || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const path = manager ? `/orders/${order.id}/manager-comment` : `/orders/${order.id}/buyer-comment`;
      await request(path, { method: "PATCH", body: JSON.stringify(manager ? { managerComment: value.trim() || null, expectedManagerComment: order.managerComment ?? null } : { buyerComment: value.trim() || null, expectedBuyerComment: order.buyerComment ?? null }) });
      await onSaved();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} centered size={480} aria-label={`${title}: ${order.number}`} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} closeOnEscape={!busy} closeOnClickOutside={!busy} returnFocus title={title}>
    <form className="orders-customer-wishes-form" onSubmit={submit}>
      <CrmTextarea data-autofocus autoFocus highlighted label={manager ? ui.managerNotes : ui.customerWishes} value={value} onChange={(event) => setValue(event.target.value)} autosize minRows={4} maxRows={10} maxLength={5000} />
      {error && <CrmAlert>{error}</CrmAlert>}
      <footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.save}</CrmButton></footer>
    </form>
  </Modal>;
}

function CurrencyChangeModal({ order, request, onClose, onSaved }: { order: Order; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [targetCurrency, setTargetCurrency] = useState(["EUR", "USD", "UAH"].find((currency) => currency !== order.currency) || "EUR");
  const [status, setStatus] = useState<ExchangeRateStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { request("/finance/exchange-rates").then((value) => setStatus(value as ExchangeRateStatus)).catch((reason) => setError((reason as Error).message)); }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await request(`/orders/${order.id}/currency`, { method: "PATCH", body: JSON.stringify({ currency: targetCurrency }) }); await onSaved(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const pair = `${order.currency}/${targetCurrency}`;
  const supported = status?.supportedPairs.includes(pair) ?? false;
  return <Modal opened onClose={onClose} centered size={520} aria-label={`${ui.currencyChange} ${order.number}`} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ "aria-label": ui.close }} title={<div><small>{ui.currencyChange}</small><h2>{order.number}</h2></div>}>
    <form className="orders-currency-form" onSubmit={submit}>
      <p>{ui.currencyChangeHint}</p>
      <div className="orders-currency-pair"><strong>{order.currency}</strong><span aria-hidden="true">→</span><CrmNativeSelect label={ui.newCurrency} value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)} data={["EUR", "USD", "UAH"].filter((currency) => currency !== order.currency)} /></div>
      {status ? <div className="orders-currency-source"><span>{ui.officialRateSource}</span><strong>{status.provider === "NBU" ? ui.nbuName : ui.ecbName}</strong><a href={status.officialUrl} target="_blank" rel="noreferrer">{ui.openOfficialSource}</a><small>{status.cache ? `${ui.rateEffectiveDate}: ${new Intl.DateTimeFormat("ru-RU").format(new Date(`${status.cache.effectiveDate}T00:00:00Z`))}` : ui.rateNotLoaded}</small></div> : !error && <p>{ui.rateLoading}</p>}
      <p className="orders-currency-warning">{ui.currencyHistoryWarning}</p>
      {status && !supported && <div className="phase2-error" role="alert">{ui.currencyPairUnsupported}</div>}
      {error && <div className="phase2-error" role="alert">{error}</div>}
      <footer><CrmButton tone="secondary" type="button" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" disabled={busy || !status?.cache || !supported}>{busy ? ui.currencyChanging : ui.confirmCurrencyChange}</CrmButton></footer>
    </form>
  </Modal>;
}

function DeliveryContactModal({ order, request, onClose, onSaved }: { order: Order; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const initialPhone = order.deliveryRecipientPhone || order.client.phone || "";
  const initialEmail = deliveryEmail(order) || order.client.email || "";
  const [recipientPhone, setRecipientPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request(`/orders/${order.id}/delivery-contact`, { method: "PATCH", body: JSON.stringify({ recipientPhone: recipientPhone.trim() || null, email: email.trim() || null, expectedRecipientPhone: order.deliveryRecipientPhone ?? null, expectedEmail: deliveryEmail(order) ?? null }) });
      await onSaved();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal opened onClose={onClose} centered size={440} aria-label={`${ui.editDeliveryContacts}: ${order.number}`} closeButtonProps={{ "aria-label": ui.close, disabled: busy }} closeOnEscape={!busy} closeOnClickOutside={!busy} returnFocus title={ui.editDeliveryContacts}>
    <form className="orders-delivery-contact-form" onSubmit={submit}>
      <CrmTextInput data-autofocus autoFocus highlighted label={ui.phone} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} maxLength={80} />
      <CrmTextInput highlighted label={ui.email} type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} />
      <p>{ui.deliveryContactHint}</p>
      {error && <CrmAlert>{error}</CrmAlert>}
      <footer><CrmButton type="button" tone="secondary" disabled={busy} onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" loading={busy}>{ui.save}</CrmButton></footer>
    </form>
  </Modal>;
}

function DeliveryAddressModal({ order, request, onClose, onSaved }: { order: Order; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [useClientAddress, setUseClientAddress] = useState(!order.deliveryAddressSet);
  const [recipientMatchesClient, setRecipientMatchesClient] = useState(!order.deliveryRecipient || order.deliveryRecipient === order.client.displayName);
  const [recipient, setRecipient] = useState(order.deliveryRecipient || order.client.displayName);
  const [addressLine1, setAddressLine1] = useState(order.deliveryAddressSet ? order.deliveryAddressLine1 || "" : order.client.address || "");
  const [addressLine2, setAddressLine2] = useState(order.deliveryAddressLine2 || "");
  const [city, setCity] = useState(order.deliveryAddressSet ? order.deliveryCity || "" : order.client.city || "");
  const [region, setRegion] = useState(order.deliveryRegion || "");
  const [postalCode, setPostalCode] = useState(order.deliveryAddressSet ? order.deliveryPostalCode || "" : order.client.postalCode || "");
  const [country, setCountry] = useState(order.deliveryAddressSet ? order.country || "" : order.client.country || order.country || "");
  const [addressText, setAddressText] = useState(order.deliveryAddressSet ? order.deliveryAddressText || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clientAddressText = clientAddress(order) || ui.notSpecified;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request(`/orders/${order.id}/delivery-address`, { method: "PATCH", body: JSON.stringify({ useClientAddress, recipientMatchesClient, recipient, addressLine1, addressLine2, city, region, postalCode, country, addressText }) });
      await onSaved();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <Modal opened onClose={onClose} centered size={620} aria-label={`${ui.deliveryInformation} ${order.number}`} closeButtonProps={{ "aria-label": ui.close }} classNames={{ content: "orders-delivery-modal", header: "orders-delivery-modal-header", body: "orders-delivery-modal-body" }} title={<div><small>{ui.deliveryInformation}</small><h2>{order.number}</h2></div>}>
    <form className="orders-delivery-form" onSubmit={submit}>
      <fieldset className="orders-delivery-source"><legend>{ui.customerDeliveryAddress}</legend><Radio data-autofocus autoFocus className={`orders-delivery-source-option${useClientAddress ? " active" : ""}`} name="delivery-address-source" checked={useClientAddress} onChange={() => setUseClientAddress(true)} label={<span><b>{ui.useClientAddress}</b><small>{clientAddressText}</small></span>} /><Radio className={`orders-delivery-source-option${!useClientAddress ? " active" : ""}`} name="delivery-address-source" checked={!useClientAddress} onChange={() => setUseClientAddress(false)} label={<span><b>{ui.useNewAddress}</b><small>{ui.editDeliveryAddress}</small></span>} /></fieldset>
      <fieldset className="orders-delivery-details" disabled={useClientAddress || busy}><legend>{ui.addressDetails}</legend>
        <div className="orders-delivery-recipient-heading"><strong>{ui.recipient}</strong><CrmCheckbox checked={recipientMatchesClient} onChange={(event) => setRecipientMatchesClient(event.currentTarget.checked)} label={ui.recipientMatchesClient} /></div>
        {!recipientMatchesClient && <CrmTextInput highlighted label={ui.recipient} value={recipient} onChange={(event) => setRecipient(event.target.value)} />}
        <CrmTextInput highlighted className="orders-delivery-wide" label={ui.addressLine1} value={addressLine1} onChange={(event) => { setAddressLine1(event.target.value); setAddressText(""); }} />
        <CrmTextInput highlighted className="orders-delivery-wide" label={ui.addressLine2} value={addressLine2} onChange={(event) => { setAddressLine2(event.target.value); setAddressText(""); }} />
        <CrmTextInput highlighted label={ui.city} value={city} onChange={(event) => { setCity(event.target.value); setAddressText(""); }} />
        <CrmTextInput highlighted label={ui.region} value={region} onChange={(event) => { setRegion(event.target.value); setAddressText(""); }} />
        <CrmTextInput highlighted label={ui.postalCode} value={postalCode} onChange={(event) => { setPostalCode(event.target.value); setAddressText(""); }} />
        <CountrySelect value={country} disabled={useClientAddress || busy} onChange={next => { if(next !== country){ setCountry(next); setAddressText(""); } }} />
        <CrmTextarea highlighted className="orders-delivery-wide" label={ui.fullAddress} value={addressText} onChange={(event) => setAddressText(event.target.value)} autosize minRows={3} maxRows={6} />
      </fieldset>
      {useClientAddress && <p className="orders-delivery-client-note"><strong>{ui.currentClientAddress}:</strong> {clientAddressText}</p>}
      {error && <CrmAlert>{error}</CrmAlert>}
      <footer><CrmButton tone="secondary" type="button" onClick={onClose}>{ui.cancel}</CrmButton><CrmButton type="submit" disabled={busy}>{busy ? ui.saving : ui.saveAddress}</CrmButton></footer>
    </form>
  </Modal>;
}


function OrderClientPicker({ clients, loading, query, onQuery, onSelect, onClose }: { clients: OrderClientBrief[]; loading: boolean; query: string; onQuery: (value: string) => void; onSelect: (id: string) => void; onClose: () => void }) {
  return <Modal opened onClose={onClose} centered size={520} aria-label={ui.selectClient} closeButtonProps={{ "aria-label": ui.close }} classNames={{ content: "orders-client-picker", header: "orders-client-picker-header", body: "orders-client-picker-body" }} title={<div><small>{ui.newOrder}</small><h2>{ui.selectClient}</h2></div>}>
    <CrmSearchField className="orders-client-search" value={query} onValueChange={onQuery} placeholder={ui.searchClient} ariaLabel={ui.searchClient} clearLabel={ui.clearSearch} showSearchIcon autoFocus />
    {loading ? <p>{ui.loadingClients}</p> : <div className="orders-client-results">{clients.map((client) => <CrmButton tone="secondary" className="orders-client-option" key={client.id} onClick={() => onSelect(client.id)}><span><strong>{client.displayName}</strong><small><CountryFlag country={client.country} />{countryLabel(client.country) || ui.countryMissing}</small></span></CrmButton>)}{!clients.length && <p>{ui.noClients}</p>}</div>}
  </Modal>;
}

function CountryFlag({ country }: { country?: string }) { const code = countryCode(country); return code ? <span className={`fi fi-${code.toLowerCase()} orders-country-flag`} role="img" aria-label={code} /> : null; }

function Kpi({ label, value, icon, tone = "purple", active, onClick }: { label: string; value: number | null; icon: string; tone?: string; active?: boolean; onClick: () => void }) { return <button className={`orders-kpi tone-${tone}${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}><i><UiIcon name={icon} /></i><span><small>{label}</small><strong>{value ?? "—"}</strong></span></button>; }
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <button className="orders-filter-chip" onClick={onRemove}>{label}<span aria-hidden="true">×</span></button>; }
function Detail({ label, value }: { label: string; value: ReactNode }) { return <div className="orders-detail"><small>{label}</small><strong>{value}</strong></div>; }
function EditableDetail({ label, value, onClick }: { label: string; value: ReactNode; onClick: () => void }) { return <UnstyledButton className="orders-detail orders-editable-detail" onClick={onClick} aria-label={`${ui.editDeliveryAddress}: ${label}`}><small>{label}</small><strong>{value}</strong></UnstyledButton>; }

function UiIcon({ name }: { name: string }) { const paths: Record<string, React.ReactNode> = { search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>, filter: <><path d="M4 5h16M7 12h10M10 19h4" /></>, settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.5 6A8 8 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.5 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></>, edit: <><path d="m4 20 4.2-1 10.4-10.4a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" /><path d="m14.5 7.1 2.8 2.8" /></>, download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></>, chevronRight: <path d="m9 6 6 6-6 6" />, chevronLeft: <path d="m15 6-6 6 6 6" />, chevronDown: <path d="m6 9 6 6 6-6" />, warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4m0 3h.01" /></>, image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-5L5 20" /></>, bag: <><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>, payment: <><path d="M7 3h10v18H7z" /><path d="M10 7h4m-4 4h4m-5 6h6" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>, clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>, truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>, check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> }; return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.check}</svg>; }
function OrderChannelIcon({ channel }: { channel: string }) { const key = channel.toUpperCase(); if (key === "FACEBOOK") return <span className="orders-channel facebook" title="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4.3c-.5-.1-2-.3-3.8-.3C9.7 4 7.3 6.1 7.3 10v2H4v4h3.3v8h4V16h3.3l.5-4h-3.8v-1.6C11.3 8.8 11.7 8 14 8Z" /></svg></span>; if (key === "INSTAGRAM") return <span className="orders-channel instagram" title="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="7" r="1" /></svg></span>; if (key === "WHATSAPP") return <span className="orders-channel whatsapp" title="WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4A8 8 0 1 1 20 11.7Z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9 8c.5 3 2 4.5 5 5l1-1 2 1.5c-1 2-3 2-5.5.7A8 8 0 0 1 7.8 10C7.5 8.5 8 7.5 9 8Z" /></svg></span>; if (key === "EMAIL") return <span className="orders-channel email" title="Email"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg></span>; if (key === "CHATWOOT") return <span className="orders-channel chatwoot" title="Chatwoot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" /></svg></span>; return <span className="orders-channel manual" title={ui.manualChannel}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17-1 4 4-1L19 8l-3-3L4 17Z" /></svg></span>; }

function isActiveOrder(order: Order) { return !["COMPLETED", "CANCELLED"].includes(order.salesStatus); }
function isOperationalOrder(order: Order) { return isActiveOrder(order) && !["RETURNED","LOST"].includes(order.shippingStatus) && !["DELIVERED","REVIEW_REQUESTED"].includes(order.salesStatus) && !orderTimelinePresentation(order).dispatched; }
function isReadyToShip(order: Order) { return orderReadyToShip(order); }
function paid(order: Order) { return orderSettlement(order).paidMinor; }
function depositShortfall(order: Order) { const value = paid(order); return value !== null && value < order.depositRequiredMinor; }
function hasBalance(order: Order) { const value = balance(order); return value !== null && value > 0; }
function balance(order: Order) { return orderSettlement(order).balanceMinor; }
function itemQuantity(order: Order) { return orderCostumeQuantity(order); }
function athleteCount(order: Order) { return orderAssignedAthleteCount(order); }
function itemImage(item: Order["items"][number]) { return item.modelImagePath ? `/api/orders/images/${item.modelImagePath}` : null; }
function designPaths(order: Order) { return orderDesignImagePaths(order); }
function designCount(order: Order) { return orderDesignCount(order); }
function quantitySummary(order: Order) { return `${itemQuantity(order)} ${ui.pieces}`; }
function OrderDesigns({ order, onPreview, onLeave }: { order: Order; onPreview: (event: ReactMouseEvent<HTMLImageElement>) => void; onLeave: () => void }) { const paths = designPaths(order); if (!paths.length) return <span className="orders-design-placeholder"><UiIcon name="image" /></span>; return <div className="orders-design-stack">{paths.slice(0, 3).map((path) => <img key={path} loading="lazy" src={path} alt={ui.orderDesignAlt} referrerPolicy="no-referrer" onMouseEnter={onPreview} onMouseMove={onPreview} onMouseLeave={onLeave} />)}{paths.length > 3 && <b>+{paths.length - 3}</b>}</div>; }
function orderProblems(order: Order) { const problems: string[] = []; if (days(order) < 0 && isActiveOrder(order)) problems.push(ui.problems.overdue); if (orderMeasurementState(order).problem === "dimensions") problems.push(ui.problems.dimensions); if (!hasDeliveryAddress(order)) problems.push(ui.problems.address); if (paid(order) === null && isActiveOrder(order)) problems.push(dataEvidenceUi.unavailable); else if (depositShortfall(order) && isActiveOrder(order)) problems.push(ui.problems.payment); if (!designPaths(order).length) problems.push(ui.problems.design); return problems; }
function nextOrderAction(order: Order): { label: string; detail?: string; tone: string; icon: string } { if (orderMeasurementState(order).nextAction === "dimensions") return { label: ui.actions.dimensions, tone: "amber", icon: "warning" }; if (!hasDeliveryAddress(order) && isReadyToShip(order)) return { label: ui.actions.address, tone: "red", icon: "warning" }; if (paid(order) === null) return { label: dataEvidenceUi.unavailable, tone: "amber", icon: "warning" }; if (depositShortfall(order)) return { label: ui.actions.deposit, detail: money(order.depositRequiredMinor - paid(order)!, order.currency), tone: "amber", icon: "payment" }; if (["DESIGN_DISCUSSION", "WAITING_COACH_APPROVAL"].includes(order.salesStatus)) return { label: ui.actions.design, tone: "purple", icon: "image" }; if (!NON_PRODUCTION_ORDER_TYPES.has(order.type) && order.productionStatus === "NOT_SCHEDULED") return { label: ui.actions.production, tone: "green", icon: "check" }; if (order.productionStatus === "READY" && hasBalance(order)) return { label: ui.actions.balance, detail: money(balance(order), order.currency), tone: "amber", icon: "payment" }; if (isReadyToShip(order)) return { label: ui.actions.shipping, tone: "green", icon: "truck" }; return { label: ui.actions.none, tone: "muted", icon: "check" }; }
function hasMeasurements(order: Order) { return orderMeasurementState(order).complete; }
function isMultiOrder(order: Order) { return order.type === "GROUP_ORDER" || order.type === "PAIR" || order.items.length > 1; }
function primaryMeasurement(order: Order) { return ownedMeasurement(order.measurement, order.athlete) || ownedMeasurement(order.items[0]?.measurement, order.items[0]?.athlete || order.athlete); }
function measurementAthlete(order: Order) { return order.athlete || order.items[0]?.athlete; }
function measurementSizes(values?: Record<string, number>) { if (!values) return ui.notReceived; const height = values.standardHeight ? `${values.standardHeight} / ` : ""; return `${height}${[values.m1, values.m2, values.m3, values.m15].map((value) => value ?? "—").join(" / ")} см`; }
function discipline(value?: string) { const codes: Record<string, string> = { RHYTHMIC_GYMNASTICS: "RG", ACROBATIC_GYMNASTICS: "ACRO", FIGURE_SKATING: "FS", AEROBIC_GYMNASTICS: "AERO", BATON_TWIRLING_MAJORETTE: "TW", OTHER: "—" }; const labels = ui.disciplines as Record<string, string>; return { code: codes[value || ""] || "—", label: labels[value || ""] || ui.disciplines.missing }; }
function parseSavedOrderSort(value: string | null): SortState | undefined { try { const parsed = JSON.parse(value || "null") as Partial<SortState> | null; return parsed && SORTABLE_ORDER_COLUMNS.includes(parsed.column as SortColumnId) && (parsed.direction === "asc" || parsed.direction === "desc") ? parsed as SortState : undefined; } catch { return undefined; } }
function carrierLabel(value: string) { return (ui.carriers as Record<string, string>)[value] || value; }
function money(value: number | null, currency: string) { return value === null ? dataEvidenceUi.unavailable : moneyLabel(value,currency); }
function days(order: Order) { return orderDeadlineDays(order); }
function date(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function deliveryDate(order: Order) { return order.requiredDeliveryAt ? date(order.requiredDeliveryAt) : ui.notSpecified; }
function dayText(order: Order) { const value = days(order); return value === 9999 ? ui.noDeadline : value < 0 ? `${ui.overdueBy} ${Math.abs(value)} ${ui.daysShort}` : value === 0 ? ui.today : `${ui.inDays} ${value} ${ui.daysShort}`; }
function ageText(value: string) { const count = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)); return count === 0 ? ui.today : `${count} ${ui.daysAgo}`; }
function deliveryCountry(order: Order) { return order.deliveryAddressSet ? order.country : order.country || order.client.country; }
function orderTrackingNumber(order: Order) { return (order.shipment?.trackingNumber || order.deliveryTrackingCode || "").trim(); }
function orderHasShippedDelivery(order: Order) { return ["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(order.shippingStatus) || Boolean(orderTrackingNumber(order)); }
function deliveryRecipient(order: Order) { return order.deliveryAddressSet ? order.deliveryRecipient || ui.notSpecified : order.client.displayName; }
function deliveryEmail(order: Order) { return (order as Order & { deliveryEmail?: string }).deliveryEmail; }
function clientAddress(order: Order) { return [order.client.address, order.client.city, order.client.postalCode, order.client.country].filter(Boolean).join(", "); }
function deliveryPlace(order: Order) { if (!order.deliveryAddressSet) return [order.client.address, order.client.city, order.client.postalCode, order.country || order.client.country].filter(Boolean).join(", ") || ui.addressMissing; return order.deliveryAddressText || [order.deliveryAddressLine1, order.deliveryAddressLine2, order.deliveryCity, order.deliveryRegion, order.deliveryPostalCode, order.country].filter(Boolean).join(", ") || ui.addressMissing; }
function hasDeliveryAddress(order: Order) { return hasUsableDeliveryAddress(order); }
function countryCode(country?: string) { if (!country) return ""; const known = findCountry(country); if (known) return known.code.toUpperCase(); const normalized = country.trim(); const prefixedCode = normalized.toUpperCase().match(/^([A-Z]{2})(?:\s|$)/)?.[1]; const aliases: Record<string, string> = { ukraine: "UA", украина: "UA", україна: "UA", france: "FR", франция: "FR", italy: "IT", италия: "IT", spain: "ES", испания: "ES", germany: "DE", германия: "DE", netherlands: "NL", нидерланды: "NL", poland: "PL", польша: "PL", usa: "US", "united states": "US", "united kingdom": "GB", britain: "GB" }; return prefixedCode || aliases[normalized.toLocaleLowerCase("ru")] || (normalized.length === 2 ? normalized.toUpperCase() : ""); }
function countryLabel(country?: string) { return country?.trim().replace(/^[A-Z]{2}\s+/i, "") || ""; }
function quickFilterLabel(value: QuickFilter) { return ({ active: ui.kpis.active, urgent: ui.urgent, deposit: ui.withoutDeposit, depositShortfall: ui.kpis.deposit, work: ui.inWork, ready: ui.ready, completed: ui.kpis.completed, overdue: ui.kpis.overdue, all: ui.all })[value]; }
