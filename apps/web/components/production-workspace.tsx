"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Badge, Group, Modal } from "@mantine/core";
import { productionUi, overviewTargetUi } from "../lib/i18n";
import { clearOrderContextUrl, orderContextId, resolveOrderContext } from "../lib/order-context";
import { buildProductionMetrics, groupProductionOrdersBySchedule, orderMatchesProductionFilters, productionAddDays, productionDayDiff, productionIso, productionLocalDate, productionRange, sortProductionOrdersByShippingProximity, type ProductionFilters, type ProductionOrderView, type ProductionRangeMode, type ProductionSlotView, type ProductionSortMode } from "../lib/production-view";
import { CrmAlert } from "./crm/alert";
import { CrmButton } from "./crm/settings-controls";
import { ProductionFiltersBar, ProductionHeader, ProductionKpis, ProductionOrderDetails, ProductionTimeline } from "./production-planner-view";

type ProductionSettings = { defaultDurationDays: number; shippingLeadDays: number };
type Preview = { src: string; x: number; y: number; country: string; quantity: number; total: string };
type Props = { role?: string; onOpenOrder?: (orderId: string) => void; onCreateOrder?: () => void };
const PREVIEW_WIDTH_KEY = "orders-image-preview-width-v1";
const DEFAULT_FILTERS: ProductionFilters = { query: "", payment: "all", production: "all", shipping: "all", slot: "all", deadline: "all" };

function startOfCalendarWeek(value: Date) {
  const date = productionLocalDate(value);
  return productionAddDays(date, date.getDay() === 0 ? -6 : 1 - date.getDay());
}
function clearProductionContextAction() { window.history.replaceState(null, "", clearOrderContextUrl(window.location.href)); }

export function ProductionWorkspace({ role, onOpenOrder, onCreateOrder }: Props = {}) {
  const now = new Date(), contextOrderHandled = useRef(false), loadSequence = useRef(0);
  const slotSaveQueues = useRef(new Map<string, Promise<void>>()), slotSaveVersions = useRef(new Map<string, number>());
  const deadlineSaveQueues = useRef(new Map<string, Promise<void>>()), deadlineSaveVersions = useRef(new Map<string, number>());
  const confirmedSlots = useRef(new Map<string, ProductionSlotView | undefined>()), confirmedDeadlines = useRef(new Map<string, string | undefined>());
  const [mode, setMode] = useState<ProductionRangeMode>("month");
  const [base, setBase] = useState(() => startOfCalendarWeek(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [orders, setOrders] = useState<ProductionOrderView[]>([]);
  const [productionSettings, setProductionSettings] = useState<ProductionSettings | null>(null);
  const [filters, setFilters] = useState<ProductionFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overviewWork, setOverviewWork] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("overviewFilter") === "work");
  const [sortMode, setSortMode] = useState<ProductionSortMode>("schedule");
  const [capacityPerDay, setCapacity] = useState(3);
  const [previewWidth, setPreviewWidth] = useState(600);
  const [selected, setSelected] = useState<string>();
  const [slotDeleteOpen, setSlotDeleteOpen] = useState(false), [slotDeleting, setSlotDeleting] = useState(false);
  const [preview, setPreview] = useState<Preview>(), [error, setError] = useState("");
  const range = productionRange(mode);
  const days = useMemo(() => Array.from({ length: range.days }, (_, index) => productionAddDays(base, index)), [base, range.days]);

  async function load(signal?: AbortSignal) {
    setProductionSettings(null);
    const sequence = ++loadSequence.current, contextId = orderContextId(window.location.search), rangeEnd = productionAddDays(base, range.days - 1);
    const params = overviewWork ? new URLSearchParams({ overviewFilter: "work" }) : new URLSearchParams({ from: productionIso(base), to: productionIso(rangeEnd) });
    if (contextId) params.set("orderId", contextId);
    const productionUrl = `/api/orders/production?${params.toString()}`;
    try {
      const [ordersResponse, defaultsResponse] = await Promise.all([fetch(productionUrl, { credentials: "include", signal }), fetch("/api/orders/defaults", { credentials: "include", signal })]);
      if (signal?.aborted || sequence !== loadSequence.current) return;
      if (!ordersResponse.ok || !defaultsResponse.ok) { setProductionSettings(null); setError(productionUi.loadError); return; }
      const [loadedOrders, defaults] = await Promise.all([ordersResponse.json() as Promise<ProductionOrderView[]>, defaultsResponse.json() as Promise<ProductionSettings>]);
      if (signal?.aborted || sequence !== loadSequence.current) return;
      if (!Number.isInteger(defaults.defaultDurationDays) || !Number.isInteger(defaults.shippingLeadDays)) { setProductionSettings(null); setError(productionUi.loadError); return; }
      const workingOrders=loadedOrders.filter(order=>order.salesStatus!=="COMPLETED");
      confirmedSlots.current = new Map(workingOrders.map((order) => [order.id, order.productionSlot]));
      confirmedDeadlines.current = new Map(workingOrders.map((order) => [order.id, order.requiredDeliveryAt]));
      setOrders(workingOrders); setProductionSettings(defaults);
      let contextError = "";
      if (!contextOrderHandled.current) {
        const resolved = resolveOrderContext(workingOrders, window.location.search);
        if (resolved.requested) {
          contextOrderHandled.current = true;
          if (resolved.order) {
            setSelected(resolved.order.id);
            setFilters((current) => ({ ...current, query: resolved.order!.number }));
            const anchor = resolved.order.productionSlot?.startsAt || resolved.order.requiredDeliveryAt;
            if (anchor) setBase(startOfCalendarWeek(productionLocalDate(anchor)));
          } else contextError = productionUi.contextOrderUnavailable;
          clearProductionContextAction();
        }
      }
      setError(contextError);
    } catch (reason) {
      if (signal?.aborted || sequence !== loadSequence.current || (reason instanceof Error && reason.name === "AbortError")) return;
      setProductionSettings(null); setError(productionUi.loadError);
    }
  }

  useEffect(() => { const controller = new AbortController(), timer = window.setTimeout(() => void load(controller.signal), 80); return () => { window.clearTimeout(timer); controller.abort(); }; }, [base, mode, overviewWork]);
  useEffect(() => { const capacity = Number(localStorage.getItem("production-capacity")); if (capacity >= 1 && capacity <= 10) setCapacity(capacity); const width = Number(localStorage.getItem(PREVIEW_WIDTH_KEY)); if (Number.isFinite(width) && width >= 200 && width <= 1200) setPreviewWidth(width); }, []);

  const activeOrders = useMemo(() => orders.filter((order) => order.productionStatus !== "CANCELLED"), [orders]);
  const visibleOrders = useMemo(() => {
    const filtered = activeOrders.filter((order) => orderMatchesProductionFilters(order, filters));
    return sortMode === "shippingProximity" ? sortProductionOrdersByShippingProximity(filtered) : groupProductionOrdersBySchedule(filtered);
  }, [activeOrders, filters, sortMode]);
  const metrics = useMemo(() => buildProductionMetrics(activeOrders, base, range.days, capacityPerDay, productionSettings?.defaultDurationDays ?? 7), [activeOrders, base, range.days, capacityPerDay, productionSettings]);
  const selectedOrder = orders.find((order) => order.id === selected), periodEnd = productionAddDays(base, range.days - 1);
  const periodFocus = productionAddDays(base, Math.floor((range.days - 1) / 2));
  const periodLabel = mode === "month"
    ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(periodFocus)
    : base.getMonth() === periodEnd.getMonth() && base.getFullYear() === periodEnd.getFullYear()
      ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(base)
      : `${new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric" }).format(base)} — ${new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric" }).format(periodEnd)}`;
  const canManageOrders = role === "OWNER" || role === "ADMIN" || role === "MANAGER";
  function clearOverviewFilter() {
    const url = new URL(window.location.href); url.searchParams.delete("overviewFilter");
    window.history.replaceState(window.history.state, "", url); setOverviewWork(false);
  }
  function setCapacityValue(value: number) { setCapacity(value); localStorage.setItem("production-capacity", String(value)); }
  function setPreviewWidthValue(value: number) { const safe = Math.max(200, Math.min(1200, Math.round(value))); setPreviewWidth(safe); localStorage.setItem(PREVIEW_WIDTH_KEY, String(safe)); }

  function saveSlot(order: ProductionOrderView, slot: ProductionSlotView) {
    setError("");
    const payload = { startsAt: slot.startsAt, endsAt: slot.endsAt, capacity: slot.capacity, tentative: slot.tentative, locked: slot.locked };
    const version = (slotSaveVersions.current.get(order.id) ?? 0) + 1;
    slotSaveVersions.current.set(order.id, version);
    setOrders((list) => list.map((item) => item.id === order.id ? { ...item, productionSlot: { ...slot, ...payload } } : item));
    const operation = (slotSaveQueues.current.get(order.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        const response = await fetch(`/api/orders/${order.id}/production-slot`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || productionUi.saveError); }
        const saved = await response.json() as ProductionSlotView;
        confirmedSlots.current.set(order.id, saved);
        if (slotSaveVersions.current.get(order.id) === version) setOrders((list) => list.map((item) => item.id === order.id ? { ...item, productionSlot: saved } : item));
      } catch (reason) {
        if (slotSaveVersions.current.get(order.id) === version) {
          setError(reason instanceof Error ? reason.message : productionUi.saveError);
          setOrders((list) => list.map((item) => item.id === order.id ? { ...item, productionSlot: confirmedSlots.current.get(order.id) } : item));
        }
      }
    });
    slotSaveQueues.current.set(order.id, operation);
    void operation.finally(() => { if (slotSaveQueues.current.get(order.id) === operation) slotSaveQueues.current.delete(order.id); });
  }

  function saveDeadline(order: ProductionOrderView, requiredDeliveryAt: string) {
    setError("");
    const version = (deadlineSaveVersions.current.get(order.id) ?? 0) + 1;
    deadlineSaveVersions.current.set(order.id, version);
    setOrders((list) => list.map((item) => item.id === order.id ? { ...item, requiredDeliveryAt } : item));
    const operation = (deadlineSaveQueues.current.get(order.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        const response = await fetch(`/api/orders/${order.id}/deadline`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requiredDeliveryAt }) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || productionUi.deadlineSaveError); }
        const saved = await response.json() as { requiredDeliveryAt?: string };
        const confirmed = saved.requiredDeliveryAt || requiredDeliveryAt;
        confirmedDeadlines.current.set(order.id, confirmed);
        if (deadlineSaveVersions.current.get(order.id) === version) setOrders((list) => list.map((item) => item.id === order.id ? { ...item, requiredDeliveryAt: confirmed } : item));
      } catch (reason) {
        if (deadlineSaveVersions.current.get(order.id) === version) {
          setError(reason instanceof Error ? reason.message : productionUi.deadlineSaveError);
          setOrders((list) => list.map((item) => item.id === order.id ? { ...item, requiredDeliveryAt: confirmedDeadlines.current.get(order.id) } : item));
        }
      }
    });
    deadlineSaveQueues.current.set(order.id, operation);
    void operation.finally(() => { if (deadlineSaveQueues.current.get(order.id) === operation) deadlineSaveQueues.current.delete(order.id); });
  }

  async function deleteSlot() {
    if (!selectedOrder?.productionSlot || slotDeleting) return;
    if (!selectedOrder.productionSlot.updatedAt) { setError(productionUi.deleteSlotError); await load(); return; }
    setSlotDeleting(true); setError("");
    try {
      const response = await fetch(`/api/orders/${selectedOrder.id}/production-slot`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: selectedOrder.productionSlot.updatedAt }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || productionUi.deleteSlotError); }
      setOrders((list) => list.map((order) => order.id === selectedOrder.id ? { ...order, productionSlot: undefined, productionStatus: "NOT_SCHEDULED" } : order)); setSlotDeleteOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : productionUi.deleteSlotError); await load(); }
    finally { setSlotDeleting(false); }
  }

  function drag(order: ProductionOrderView, edge: "move" | "left" | "right", event: ReactPointerEvent) {
    if (!order.productionSlot || !productionSettings) { setError(productionUi.loadError); return; }
    if (order.productionSlot.locked) return;
    event.preventDefault();
    const bar = (event.currentTarget as HTMLElement).closest(".timeline-bar") as HTMLElement | null, startX = event.clientX;
    const originalStart = productionDayDiff(order.productionSlot.startsAt, base), originalEnd = productionDayDiff(order.productionSlot.endsAt, base);
    const shippingLimit = order.requiredDeliveryAt ? productionDayDiff(productionAddDays(order.requiredDeliveryAt, -productionSettings.shippingLeadDays), base) : undefined;
    let last = 0, moved = false, latestSlot = order.productionSlot;
    const move = (pointer: PointerEvent) => {
      const delta = Math.round((pointer.clientX - startX) / range.dayWidth); if (delta === last || delta === 0) return; last = delta; moved = true; if (bar) bar.dataset.dragged = "true";
      let starts = originalStart, ends = originalEnd;
      if (edge === "move") { starts += delta; ends += delta; }
      if (edge === "left") starts = Math.min(originalEnd, originalStart + delta);
      if (edge === "right") ends = Math.max(originalStart, originalEnd + delta);
      if (shippingLimit !== undefined && ends > shippingLimit) { if (edge === "move") { starts -= ends - shippingLimit; ends = shippingLimit; } else if (edge === "right") { if (shippingLimit < originalStart) return; ends = shippingLimit; } }
      latestSlot = { ...order.productionSlot!, startsAt: productionIso(productionAddDays(base, starts)), endsAt: productionIso(productionAddDays(base, ends)) };
      setOrders((list) => list.map((item) => item.id === order.id ? { ...item, productionSlot: latestSlot } : item));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (moved) void saveSlot(order, latestSlot); window.setTimeout(() => { if (bar) delete bar.dataset.dragged; }, 0); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
  }

  function autoSchedule(order: ProductionOrderView) {
    if (!productionSettings) { setError(productionUi.loadError); return; }
    const end = order.requiredDeliveryAt ? productionAddDays(order.requiredDeliveryAt, -productionSettings.shippingLeadDays) : productionAddDays(base, 14);
    void saveSlot(order, { startsAt: productionIso(productionAddDays(end, -(productionSettings.defaultDurationDays - 1))), endsAt: productionIso(end), capacity: 1, tentative: true, locked: false });
  }

  return <main className="production-page">
    <ProductionHeader periodLabel={periodLabel} mode={mode} onMode={setMode} onPrevious={() => setBase(productionAddDays(base, -range.shiftDays))} onNext={() => setBase(productionAddDays(base, range.shiftDays))} onToday={() => setBase(startOfCalendarWeek(new Date()))} onCreateOrder={onCreateOrder} canCreateOrder={canManageOrders}/>
    {overviewWork && <Group role="status"><Badge>{overviewTargetUi.workFilter}</Badge><CrmButton tone="secondary" onClick={clearOverviewFilter}>{productionUi.resetFilters}</CrmButton></Group>}
    {productionSettings && <ProductionKpis metrics={metrics} capacity={capacityPerDay}/>}
    <ProductionFiltersBar filters={filters} opened={filtersOpen} sortMode={sortMode} capacity={capacityPerDay} previewWidth={previewWidth} onSortMode={setSortMode} onCapacity={setCapacityValue} onPreviewWidth={setPreviewWidthValue} onToggle={() => setFiltersOpen((opened) => !opened)} onChange={setFilters} onReset={() => { setFilters(DEFAULT_FILTERS); if(overviewWork)clearOverviewFilter(); }}/>
    {error && <CrmAlert onClose={() => setError("")}>{error}</CrmAlert>}
    {productionSettings && <div className={`production-board-shell${selectedOrder ? " has-selection" : ""}`}>
      <ProductionTimeline orders={visibleOrders} days={days} base={base} dayWidth={range.dayWidth} capacity={capacityPerDay} selectedId={selected} onSelect={(orderId) => setSelected((current) => current === orderId ? undefined : orderId)} onDrag={drag} onToggleLock={(order) => order.productionSlot && void saveSlot(order, { ...order.productionSlot, locked: !order.productionSlot.locked })} onSchedule={autoSchedule} onPreview={setPreview}/>
      {selectedOrder && (
        <ProductionOrderDetails
          order={selectedOrder}
          onClose={() => {
            setSlotDeleteOpen(false);
            setSelected(undefined);
          }}
          onOpenOrder={onOpenOrder && canManageOrders ? () => onOpenOrder(selectedOrder.id) : undefined}
          onSaveSlot={(slot) => void saveSlot(selectedOrder, slot)}
          onSaveDeadline={(value) => void saveDeadline(selectedOrder, value)}
          canEdit={canManageOrders}
          onDeleteSlot={() => setSlotDeleteOpen(true)}
        />
      )}
    </div>}
    {preview && <div className="production-image-preview" style={{ left: Math.min(preview.x + 18, window.innerWidth - Math.min(previewWidth, window.innerWidth - 36) - 18), top: Math.min(preview.y + 18, window.innerHeight - 280), width: Math.min(previewWidth, window.innerWidth - 36) }}><img src={preview.src} alt={productionUi.enlargedModel}/><div><b>{preview.country}</b><span>{preview.quantity} {productionUi.pieces}</span><strong>{preview.total}</strong></div></div>}
    <Modal opened={slotDeleteOpen} onClose={() => !slotDeleting && setSlotDeleteOpen(false)} title={productionUi.deleteSlotTitle} aria-label={productionUi.deleteSlotTitle} closeButtonProps={{ "aria-label": productionUi.close, disabled: slotDeleting }} closeOnClickOutside={!slotDeleting} closeOnEscape={!slotDeleting} returnFocus centered size={460}><p>{productionUi.deleteSlotHint}</p><div className="production-delete-slot-confirm"><CrmButton tone="secondary" disabled={slotDeleting} onClick={() => setSlotDeleteOpen(false)}>{productionUi.cancel}</CrmButton><CrmButton color="red" loading={slotDeleting} onClick={() => void deleteSlot()}>{productionUi.deleteSlotConfirm}</CrmButton></div></Modal>
  </main>;
}

export const toLocalIso = productionIso;
