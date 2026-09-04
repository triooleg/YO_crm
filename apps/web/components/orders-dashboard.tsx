"use client";

import { CSSProperties, Fragment, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ordersDashboardUi as ui } from "../lib/i18n";
import { orderLabel } from "../lib/orders-i18n";
import { MeasurementPanel } from "./measurement-panel";
import { OrderPanel } from "./order-panel";
import { OrderWorkspaceCard, type Order } from "./orders-workspace";

type ColumnId = keyof typeof ui.columnsMap;
type QuickFilter = "all" | "active" | "urgent" | "deposit" | "work" | "ready" | "completed" | "overdue";
type Props = { onNavigate: (section: "clients" | "inbox", context?: Record<string, string>) => void };
type Preview = { src: string; left: number; top: number; width: number };
type OrderClientBrief = { id: string; displayName: string; country?: string };
type OrderClientDetail = OrderClientBrief & { athletes: { id: string; firstName: string; lastName?: string; measurements: { id: string; measuredAt: string }[] }[] };

const PAGE_SIZE = 20;
const COLUMN_SETTINGS_KEY = "orders-dashboard-columns-v2";
const DEFAULT_COLUMNS: ColumnId[] = ["client", "quantity", "discipline", "designs", "deadline", "payment", "status", "nextAction", "delivery", "created", "problems", "menu"];
const SALES_STATUSES = ["NEW_LEAD", "WAITING_CLIENT_REPLY", "NEEDS_ESTIMATE", "ESTIMATE_SENT", "DESIGN_DISCUSSION", "WAITING_COACH_APPROVAL", "WAITING_DEPOSIT", "DEPOSIT_RECEIVED", "ORDER_CONFIRMED", "MEASUREMENTS_REQUIRED", "MEASUREMENTS_RECEIVED", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "FINAL_DECORATION", "QUALITY_CONTROL", "PHOTO_SENT", "WAITING_FINAL_PAYMENT", "PAID", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "REVIEW_REQUESTED", "COMPLETED", "CANCELLED"];

export function OrdersDashboard({ onNavigate }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [sort, setSort] = useState("created");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [paymentOrderId, setPaymentOrderId] = useState<string>();
  const [measurementOrder, setMeasurementOrder] = useState<Order>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set());
  const [draggedColumn, setDraggedColumn] = useState<ColumnId>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview>();
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderClients, setNewOrderClients] = useState<OrderClientBrief[]>([]);
  const [newOrderClient, setNewOrderClient] = useState<OrderClientDetail>();
  const [newOrderLoading, setNewOrderLoading] = useState(false);
  const [newOrderQuery, setNewOrderQuery] = useState("");
  const newOrderTrigger = useRef<HTMLButtonElement>(null);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(Array.isArray(body.message) ? body.message.join(", ") : body.message ?? ui.error);
    }
    return response.json();
  }

  async function load() {
    setLoading(true);
    try {
      setOrders(await request(`/orders${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`));
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMN_SETTINGS_KEY) || "null") as { order?: ColumnId[]; hidden?: ColumnId[] } | null;
      if (!saved) return;
      const known = (saved.order || []).filter((id): id is ColumnId => DEFAULT_COLUMNS.includes(id));
      setColumnOrder([...known, ...DEFAULT_COLUMNS.filter((id) => !known.includes(id))]);
      setHiddenColumns(new Set((saved.hidden || []).filter((id): id is ColumnId => DEFAULT_COLUMNS.includes(id))));
    } catch {}
  }, []);

  useEffect(() => setPage(1), [quickFilter, statusFilter, disciplineFilter, sort, search]);

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

  const metrics = useMemo(() => ({
    active: orders.filter(isActiveOrder).length,
    deposit: orders.filter((order) => isActiveOrder(order) && paid(order) < order.depositRequiredMinor).length,
    urgent: orders.filter((order) => isActiveOrder(order) && days(order) >= 0 && days(order) <= 7).length,
    overdue: orders.filter((order) => isActiveOrder(order) && days(order) < 0).length,
    ready: orders.filter(isReadyToShip).length,
    completed: orders.filter((order) => order.salesStatus === "COMPLETED").length,
  }), [orders]);

  const disciplines = useMemo(() => [...new Set(orders.map((order) => order.discipline).filter((value): value is string => Boolean(value)))].sort(), [orders]);
  const filtered = useMemo(() => orders.filter((order) => {
    if (statusFilter === "active" && !isActiveOrder(order)) return false;
    if (statusFilter !== "all" && statusFilter !== "active" && order.salesStatus !== statusFilter) return false;
    if (disciplineFilter !== "all" && order.discipline !== disciplineFilter) return false;
    if (quickFilter === "active" && !isActiveOrder(order)) return false;
    if (quickFilter === "urgent" && !(isActiveOrder(order) && days(order) >= 0 && days(order) <= 7)) return false;
    if (quickFilter === "deposit" && !(isActiveOrder(order) && paid(order) < order.depositRequiredMinor)) return false;
    if (quickFilter === "work" && !["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL"].includes(order.productionStatus)) return false;
    if (quickFilter === "ready" && !isReadyToShip(order)) return false;
    if (quickFilter === "completed" && order.salesStatus !== "COMPLETED") return false;
    if (quickFilter === "overdue" && !(isActiveOrder(order) && days(order) < 0)) return false;
    return true;
  }), [orders, quickFilter, statusFilter, disciplineFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === "deadline") return days(a) - days(b);
    if (sort === "balance") return balance(b) - balance(a);
    if (sort === "client") return a.client.displayName.localeCompare(b.client.displayName, "ru");
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [filtered, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const workspace = orders.find((order) => order.id === workspaceId);
  const paymentOrder = orders.find((order) => order.id === paymentOrderId);
  const visibleColumns = columnOrder.filter((id) => !hiddenColumns.has(id));
  const filterCount = Number(statusFilter !== "all") + Number(disciplineFilter !== "all");

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
  function selectQuickFilter(filter: QuickFilter) { setQuickFilter((current) => current === filter && filter !== "all" ? "all" : filter); }
  function clearFilters() { setQuickFilter("all"); setStatusFilter("all"); setDisciplineFilter("all"); }
  async function changeStatus(order: Order, value: string) {
    const previous = order.salesStatus;
    setOrders((items) => items.map((item) => item.id === order.id ? { ...item, salesStatus: value } : item));
    try { await request(`/orders/${order.id}/statuses`, { method: "PATCH", body: JSON.stringify({ salesStatus: value }) }); }
    catch (reason) { setOrders((items) => items.map((item) => item.id === order.id ? { ...item, salesStatus: previous } : item)); setError((reason as Error).message); }
  }
  async function changeDeadline(order: Order, value: string) {
    if (!value) return;
    try { await request(`/orders/${order.id}/deadline`, { method: "PATCH", body: JSON.stringify({ requiredDeliveryAt: value }) }); await load(); }
    catch (reason) { setError((reason as Error).message); }
  }
  function showPreview(event: ReactMouseEvent<HTMLImageElement>) {
    const image = event.currentTarget, width = Math.min(520, window.innerWidth - 24), left = event.clientX + width + 24 < window.innerWidth ? event.clientX + 16 : Math.max(12, event.clientX - width - 16), top = Math.min(Math.max(12, event.clientY - 80), window.innerHeight - Math.min(700, width * 1.4));
    setPreview({ src: image.src, left, top, width });
  }
  function exportOrders() {
    const rows = [[...ui.csvHeaders], ...sorted.map((order) => [order.number, order.client.displayName, String(itemQuantity(order)), discipline(order.discipline).label, deliveryDate(order), String(order.priceMinor), String(paid(order)), String(balance(order)), orderLabel("sales", order.salesStatus), deliveryPlace(order), orderProblems(order).join("; ")])];
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

  if (workspace) return <OrderWorkspaceCard order={workspace} onBack={() => setWorkspaceId(undefined)} request={request} refresh={load} />;

  return <section className="phase2-main orders-page orders-dashboard">
    <header className="phase2-header orders-dashboard-header">
      <div><p>{ui.eyebrow}</p><h1>{ui.title}</h1><span>{ui.subtitle}</span></div>
      <button ref={newOrderTrigger} className="phase2-primary orders-new-order" onClick={() => openNewOrder()}>{ui.newOrder} <span aria-hidden="true">⌄</span></button>
    </header>
    {error && <div className="phase2-error" role="alert">{error}<button onClick={() => void load()}>{ui.retry}</button></div>}

    <div className="orders-kpi-grid">
      <Kpi label={ui.kpis.active} value={metrics.active} icon="bag" active={quickFilter === "active"} onClick={() => selectQuickFilter("active")} />
      <Kpi label={ui.kpis.deposit} value={metrics.deposit} icon="payment" tone="amber" active={quickFilter === "deposit"} onClick={() => selectQuickFilter("deposit")} />
      <Kpi label={ui.kpis.urgent} value={metrics.urgent} icon="calendar" tone="red" active={quickFilter === "urgent"} onClick={() => selectQuickFilter("urgent")} />
      <Kpi label={ui.kpis.overdue} value={metrics.overdue} icon="clock" tone="red" active={quickFilter === "overdue"} onClick={() => selectQuickFilter("overdue")} />
      <Kpi label={ui.kpis.ready} value={metrics.ready} icon="truck" tone="green" active={quickFilter === "ready"} onClick={() => selectQuickFilter("ready")} />
      <Kpi label={ui.kpis.completed} value={metrics.completed} icon="check" tone="gray" active={quickFilter === "completed"} onClick={() => selectQuickFilter("completed")} />
    </div>

    <div className="orders-command-bar">
      <label className="orders-search"><UiIcon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={ui.search} /></label>
      <div className="orders-filter-wrap">
        <button className={`orders-filter-trigger${filterOpen ? " active" : ""}`} onClick={() => setFilterOpen((value) => !value)}><UiIcon name="filter" />{ui.filters}{filterCount > 0 && <b>{filterCount}</b>}</button>
        {filterOpen && <div className="orders-filter-popover" role="dialog" aria-label={ui.filters}>
          <label>{ui.filterStatus}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{ui.allStatuses}</option><option value="active">{ui.kpis.active}</option>{SALES_STATUSES.map((status) => <option key={status} value={status}>{orderLabel("sales", status)}</option>)}</select></label>
          <label>{ui.discipline}<select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)}><option value="all">{ui.anyDiscipline}</option>{disciplines.map((value) => <option key={value} value={value}>{discipline(value).label}</option>)}</select></label>
          <button onClick={clearFilters}>{ui.clearAll}</button>
        </div>}
      </div>
      <div className="orders-quick-filters">{([ ["all", ui.all, orders.length], ["urgent", ui.urgent, metrics.urgent], ["deposit", ui.withoutDeposit, metrics.deposit], ["work", ui.inWork, orders.filter((order) => ["SCHEDULED", "MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL"].includes(order.productionStatus)).length], ["ready", ui.ready, metrics.ready] ] as const).map(([id, label, value]) => <button key={id} className={quickFilter === id ? "active" : ""} onClick={() => selectQuickFilter(id)}>{label}<small>{value}</small></button>)}</div>
      <label className="orders-sort"><span>{ui.sortLabel}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="created">{ui.sortCreated}</option><option value="deadline">{ui.sortDeadline}</option><option value="balance">{ui.sortBalance}</option><option value="client">{ui.sortClient}</option></select></label>
      <button className="orders-columns-button" onClick={() => setColumnsOpen(true)}><UiIcon name="settings" />{ui.columns}</button>
      <button className="orders-export" onClick={exportOrders} title={ui.export} aria-label={ui.export}><UiIcon name="download" /></button>
    </div>

    {(quickFilter !== "all" || statusFilter !== "all" || disciplineFilter !== "all") && <div className="orders-filter-chips">
      {quickFilter !== "all" && <FilterChip label={quickFilterLabel(quickFilter)} onRemove={() => setQuickFilter("all")} />}
      {statusFilter !== "all" && <FilterChip label={statusFilter === "active" ? ui.activeStatus : `${ui.statusPrefix}: ${orderLabel("sales", statusFilter)}`} onRemove={() => setStatusFilter("all")} />}
      {disciplineFilter !== "all" && <FilterChip label={`${ui.discipline}: ${discipline(disciplineFilter).label}`} onRemove={() => setDisciplineFilter("all")} />}
      <button className="orders-clear-filters" onClick={clearFilters}>{ui.clearAll}</button>
    </div>}

    {selectedIds.size > 0 && <div className="orders-selection"><strong>{ui.selected}: {selectedIds.size}</strong><span>{ui.bulkHint}</span><button onClick={() => setSelectedIds(new Set())}>{ui.clearSelection}</button></div>}

    <div className="orders-table-wrap orders-table-scroll">
      <table className="orders-table orders-dashboard-table">
        <colgroup><col className="orders-controls" />{visibleColumns.map((id) => <col key={id} className={`orders-col orders-col-${id}`} />)}</colgroup>
        <thead><tr><th className="orders-controls"><input type="checkbox" aria-label={ui.selectAll} checked={shown.length > 0 && shown.every((order) => selectedIds.has(order.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(shown.map((order) => order.id)) : new Set())} /></th>{visibleColumns.map((id) => <th key={id} className={`orders-col orders-col-${id}`} style={{ order: columnOrder.indexOf(id) + 1 }}>{ui.columnsMap[id]}</th>)}</tr></thead>
        <tbody>
          {loading && <tr className="orders-state-row"><td colSpan={visibleColumns.length + 1}><span className="orders-loader" />{ui.loading}</td></tr>}
          {!loading && !error && !shown.length && <tr className="orders-state-row"><td colSpan={visibleColumns.length + 1}><strong>{ui.empty}</strong><small>{ui.emptyHint}</small>{(quickFilter !== "all" || statusFilter !== "all" || disciplineFilter !== "all") && <button onClick={clearFilters}>{ui.clearAll}</button>}</td></tr>}
          {!loading && shown.map((order) => <Fragment key={order.id}>
            <tr className={`orders-summary-row${expandedId === order.id ? " is-expanded" : ""}`}>
              <td className="orders-controls"><button className="orders-expand" aria-label={expandedId === order.id ? ui.collapse : ui.expand} aria-expanded={expandedId === order.id} onClick={() => setExpandedId((current) => current === order.id ? undefined : order.id)}><UiIcon name={expandedId === order.id ? "chevronDown" : "chevronRight"} /></button><input type="checkbox" aria-label={ui.selectOrder} checked={selectedIds.has(order.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(order.id) : next.delete(order.id); return next; })} /></td>
              {visibleColumns.map((id) => <OrderCell key={id} id={id} order={order} columnOrder={columnOrder} onStatus={changeStatus} onDeadline={changeDeadline} onPreview={showPreview} onPreviewLeave={() => setPreview(undefined)} onOpen={() => setWorkspaceId(order.id)} onClient={() => onNavigate("clients", { clientId: order.client.id })} />)}
            </tr>
            {expandedId === order.id && <tr className="orders-expanded-row"><td colSpan={visibleColumns.length + 1}><ExpandedOrder order={order} onOpen={() => setWorkspaceId(order.id)} onClient={() => onNavigate("clients", { clientId: order.client.id })} onConversation={() => onNavigate("inbox", { clientId: order.client.id, clientName: order.client.displayName })} onPayment={() => setPaymentOrderId(order.id)} onMeasurements={() => setMeasurementOrder(order)} /></td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>

    {!loading && sorted.length > 0 && <div className="orders-pagination"><span>{ui.shown} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} {ui.of} {sorted.length}</span><nav aria-label={ui.pagination}><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}><UiIcon name="chevronLeft" /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).slice(Math.max(0, page - 3), Math.max(5, page + 2)).map((value) => <button key={value} className={page === value ? "active" : ""} onClick={() => setPage(value)}>{value}</button>)}<button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}><UiIcon name="chevronRight" /></button></nav><span>{PAGE_SIZE} / {ui.rowsPerPage}</span></div>}

    {columnsOpen && <div className="orders-column-settings-overlay" onMouseDown={(event) => event.target === event.currentTarget && setColumnsOpen(false)}><aside className="orders-column-settings" role="dialog" aria-modal="true" aria-label={ui.columns}><header><div><h2>{ui.columns}</h2><small>{ui.columnsHint}</small></div><button onClick={() => setColumnsOpen(false)} aria-label={ui.close}>×</button></header><div className="orders-columns-list">{columnOrder.map((id) => <div key={id} draggable onDragStart={() => setDraggedColumn(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropColumn(id)}><span>⋮⋮</span><label><input type="checkbox" checked={!hiddenColumns.has(id)} onChange={() => toggleColumn(id)} />{ui.columnsMap[id]}</label><button onClick={() => moveColumn(id, -1)} aria-label={ui.moveUp}>↑</button><button onClick={() => moveColumn(id, 1)} aria-label={ui.moveDown}>↓</button></div>)}</div><footer><button onClick={() => persistColumns(DEFAULT_COLUMNS, new Set())}>{ui.reset}</button><button onClick={() => setColumnsOpen(false)}>{ui.done}</button></footer></aside></div>}
    {preview && <img className="orders-image-preview" src={preview.src} alt={ui.enlargedModel} style={{ left: preview.left, top: preview.top, width: preview.width }} />}
    {newOrderOpen && !newOrderClient && <OrderClientPicker clients={newOrderClients} loading={newOrderLoading} query={newOrderQuery} onQuery={setNewOrderQuery} onSelect={(id) => void selectNewOrderClient(id)} onClose={closeNewOrder} />}
    {newOrderClient && <OrderPanel client={newOrderClient} request={request} onClose={closeNewOrder} onSaved={async () => { closeNewOrder(); await load(); }} />}
    {paymentOrder && <QuickPayment order={paymentOrder} request={request} onClose={() => setPaymentOrderId(undefined)} onSaved={async () => { setPaymentOrderId(undefined); await load(); }} />}
    {measurementOrder && measurementAthlete(measurementOrder) && <MeasurementPanel client={{ id: measurementOrder.client.id, displayName: measurementOrder.client.displayName, athletes: [measurementAthlete(measurementOrder)!] }} request={request} orderId={measurementOrder.id} initialValues={primaryMeasurement(measurementOrder)?.values} expectedMeasurementId={primaryMeasurement(measurementOrder)?.id} title={primaryMeasurement(measurementOrder) ? ui.editMeasurements : ui.addMeasurements} onClose={() => setMeasurementOrder(undefined)} onSaved={async () => { setMeasurementOrder(undefined); await load(); }} />}
  </section>;
}

function OrderCell({ id, order, columnOrder, onStatus, onDeadline, onPreview, onPreviewLeave, onOpen, onClient }: { id: ColumnId; order: Order; columnOrder: ColumnId[]; onStatus: (order: Order, value: string) => void; onDeadline: (order: Order, value: string) => void; onPreview: (event: ReactMouseEvent<HTMLImageElement>) => void; onPreviewLeave: () => void; onOpen: () => void; onClient: () => void }) {
  const style = { order: columnOrder.indexOf(id) + 1 } as CSSProperties;
  if (id === "client") return <td className="orders-col orders-col-client" style={style}><div className="orders-client-cell"><button className="orders-order-number" onClick={onOpen}>{order.number}</button><OrderChannelIcon channel={order.client.source} /><button onClick={onClient}><strong>{order.client.displayName}</strong><small><CountryFlag country={order.client.country} />{countryLabel(order.client.country) || ui.countryMissing}</small></button></div></td>;
  if (id === "quantity") return <td className="orders-col orders-col-quantity" style={style}><strong>{quantitySummary(order)}</strong><small>{order.type === "GROUP_ORDER" ? `${Math.max(1, athleteCount(order))} ${ui.groupsAthletes}` : order.type === "PAIR" ? ui.pair : ui.individualShort}</small></td>;
  if (id === "discipline") { const value = discipline(order.discipline); return <td className="orders-col orders-col-discipline" style={style}><strong>{value.code}</strong><small>{value.label}</small></td>; }
  if (id === "designs") return <td className="orders-col orders-col-designs" style={style}><OrderDesigns order={order} onPreview={onPreview} onLeave={onPreviewLeave} /><small>{designCount(order) > 1 ? order.type === "GROUP_ORDER" ? `${ui.viewAll} (${designCount(order)})` : ui.viewAll : order.items[0]?.name || order.notes || ui.designMissing}</small></td>;
  if (id === "deadline") return <td className={`orders-col orders-col-deadline ${days(order) < 0 ? "orders-danger" : days(order) <= 7 ? "orders-warning" : ""}`} style={style}><label className="orders-deadline-button"><strong>{deliveryDate(order)}</strong><small>{dayText(order)}</small><input type="date" value={order.requiredDeliveryAt?.slice(0, 10) || ""} onChange={(event) => void onDeadline(order, event.target.value)} aria-label={ui.changeDeadline} /></label></td>;
  if (id === "payment") return <td className="orders-col orders-col-payment" style={style}><strong>{money(order.priceMinor, order.currency)}</strong><small className="orders-paid-line">{ui.paidPrefix} {money(paid(order), order.currency)}</small><small className="orders-balance-line">{ui.balancePrefix} {money(balance(order), order.currency)}</small></td>;
  if (id === "status") return <td className="orders-col orders-col-status" style={style}><select className={`orders-inline-status orders-status--${statusTone(order.salesStatus)}`} value={order.salesStatus} onChange={(event) => void onStatus(order, event.target.value)} aria-label={ui.changeStatus}>{SALES_STATUSES.map((status) => <option key={status} value={status}>{orderLabel("sales", status)}</option>)}</select><small>{orderLabel("production", order.productionStatus)}</small></td>;
  if (id === "nextAction") { const action = nextOrderAction(order); return <td className="orders-col orders-col-nextAction" style={style}><span className={`orders-next-action tone-${action.tone}`}><UiIcon name={action.icon} /><b>{action.label}</b></span>{action.detail && <small>{action.detail}</small>}</td>; }
  if (id === "delivery") return <td className="orders-col orders-col-delivery" style={style}><strong><CountryFlag country={order.country || order.client.country} />{countryLabel(order.country || order.client.country) || ui.addressMissing}</strong><small>{order.shipment?.carrier ? carrierLabel(order.shipment.carrier) : orderLabel("shipping", order.shippingStatus)}</small>{order.shipment?.trackingNumber && <small>{order.shipment.trackingNumber}</small>}</td>;
  if (id === "created") return <td className="orders-col orders-col-created" style={style}><strong>{date(order.createdAt)}</strong><small>{ageText(order.createdAt)}</small></td>;
  if (id === "problems") { const problems = orderProblems(order); return <td className="orders-col orders-col-problems" style={style}>{problems.length ? <span className="orders-problem-badge" title={problems.join("\n")}><UiIcon name="warning" />{problems.length === 1 ? problems[0] : problems.length}</span> : <span className="orders-no-problems">{ui.noProblems}</span>}</td>; }
  return <td className="orders-col orders-col-menu" style={style}><button className="orders-menu-button" onClick={onOpen} aria-label={ui.openOrder} title={ui.openOrder}>•••</button></td>;
}

function ExpandedOrder({ order, onOpen, onClient, onConversation, onPayment, onMeasurements }: { order: Order; onOpen: () => void; onClient: () => void; onConversation: () => void; onPayment: () => void; onMeasurements: () => void }) {
  const items = order.items.length ? order.items : [{ id: order.id, name: order.notes || ui.item, quantity: 1, priceMinor: order.priceMinor, productionStatus: order.productionStatus, modelImagePath: order.modelImagePath, athlete: order.athlete, measurement: order.measurement }];
  return <div className="orders-expanded-layout">
    <section className="orders-expanded-designs"><header><div><h3>{ui.designsInOrder} ({items.length})</h3><small>{itemQuantity(order)} {ui.itemsInOrder}</small></div>{measurementAthlete(order) && <button onClick={onMeasurements}>{primaryMeasurement(order) ? ui.editMeasurements : ui.addMeasurements}</button>}</header><div className="orders-expanded-items">{items.map((item, index) => <article key={item.id}><span className="orders-item-index">{index + 1}</span>{item.modelImagePath ? <img loading="lazy" src={`/api/orders/images/${item.modelImagePath}`} alt={item.name} /> : <span className="orders-item-placeholder"><UiIcon name="image" /></span>}<div className="orders-item-name"><strong>{item.name}</strong><small>{ui.skuMissing}</small><em>{item.quantity} {ui.pieces}</em></div><Detail label={ui.dimensions} value={item.measurement ? measurementSizes(item.measurement.values) : ui.notReceived} /><Detail label={ui.readinessDeadline} value={deliveryDate(order)} /><Detail label={ui.price} value={money(item.priceMinor, order.currency)} /><div className="orders-item-payment"><small>{ui.payment}</small><strong>{ui.paymentAtOrderLevel}</strong><span className={`orders-status orders-status--${statusTone(item.productionStatus)}`}>{orderLabel("production", item.productionStatus)}</span></div></article>)}</div></section>
    <section className="orders-expanded-card orders-expanded-finance"><h3>{ui.finance}</h3><MoneyLine label={`${ui.products} (${items.length})`} value={order.priceMinor - (order.deliveryMinor || 0) + (order.discountMinor || 0)} currency={order.currency} /><MoneyLine label={ui.discount} value={-(order.discountMinor || 0)} currency={order.currency} muted /><MoneyLine label={ui.shipping} value={order.deliveryMinor || order.shipment?.costMinor || 0} currency={order.currency} /><hr /><MoneyLine label={ui.total} value={order.priceMinor} currency={order.currency} strong /><MoneyLine label={ui.paid} value={paid(order)} currency={order.currency} success /><MoneyLine label={ui.balance} value={balance(order)} currency={order.currency} danger={balance(order) > 0} /><button className="orders-open-order" onClick={onOpen}>{ui.openOrder}</button><button className="orders-secondary-action" onClick={onPayment}>{ui.addPayment}</button></section>
    <section className="orders-expanded-card orders-expanded-delivery"><h3>{ui.shipping}</h3><Detail label={ui.country} value={<><CountryFlag country={order.country || order.client.country} />{countryLabel(order.country || order.client.country) || ui.notSpecifiedFeminine}</>} /><Detail label={ui.address} value={[order.client.city, order.client.address, order.client.postalCode].filter(Boolean).join(", ") || ui.notSpecified} /><Detail label={ui.recipient} value={order.client.displayName} /><Detail label={ui.phone} value={order.client.phone || ui.notSpecified} /><Detail label={ui.method} value={order.shipment?.carrier ? carrierLabel(order.shipment.carrier) : ui.notSpecified} /><Detail label={ui.cost} value={money(order.shipment?.costMinor || order.deliveryMinor || 0, order.shipment?.currency || order.currency)} /><Detail label={ui.tracking} value={order.shipment?.trackingNumber || ui.notSpecified} /></section>
    <section className="orders-expanded-card orders-expanded-notes"><div><h3>{ui.customerWishes}</h3><p>{order.notes || ui.notSpecified}</p></div><div><h3>{ui.managerNotes}</h3><p>{ui.notSpecified}</p></div><div className="orders-expanded-links"><button onClick={onClient}>{ui.openClient}</button><button onClick={onConversation}>{ui.openConversation}</button></div></section>
  </div>;
}

function QuickPayment({ order, request, onClose, onSaved }: { order: Order; request: (path: string, init?: RequestInit) => Promise<unknown>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); try { await request(`/orders/${order.id}/payments`, { method: "POST", body: JSON.stringify({ amountMinor: Math.round(Number(amount.replace(",", ".")) * 100), currency: order.currency, method: "BANK_TRANSFER", receivedAt: new Date().toISOString() }) }); await onSaved(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  return <div className="orders-drawer-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="orders-quick-payment" onSubmit={submit}><header><div><small>{ui.paymentTitle}</small><h2>{order.number}</h2></div><button type="button" onClick={onClose}>×</button></header><p>{ui.balance}: <strong>{money(balance(order), order.currency)}</strong></p><label>{ui.amount}<input autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required /></label>{error && <div className="phase2-error">{error}</div>}<footer><button type="button" onClick={onClose}>{ui.cancel}</button><button className="phase2-primary" disabled={busy}>{busy ? ui.saving : ui.addPaymentPlain}</button></footer></form></div>;
}

function OrderClientPicker({ clients, loading, query, onQuery, onSelect, onClose }: { clients: OrderClientBrief[]; loading: boolean; query: string; onQuery: (value: string) => void; onSelect: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => bindDialogKeyboard(dialog.current, onClose), []);
  return <div className="orders-drawer-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside ref={dialog} className="orders-client-picker" role="dialog" aria-modal="true" aria-label={ui.selectClient}><header><div><small>{ui.newOrder}</small><h2>{ui.selectClient}</h2></div><button onClick={onClose} aria-label={ui.close}>×</button></header><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder={ui.searchClient} />{loading ? <p>{ui.loadingClients}</p> : <div>{clients.map((client) => <button key={client.id} onClick={() => onSelect(client.id)}><strong>{client.displayName}</strong><small><CountryFlag country={client.country} />{countryLabel(client.country) || ui.countryMissing}</small></button>)}{!clients.length && <p>{ui.noClients}</p>}</div>}</aside></div>;
}

function CountryFlag({ country }: { country?: string }) { const code = countryCode(country); return code ? <span className={`fi fi-${code.toLowerCase()} orders-country-flag`} role="img" aria-label={code} /> : null; }

function bindDialogKeyboard(dialog: HTMLElement | null, onClose: () => void) {
  if (!dialog) return;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const items = focusable(); if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", keydown);
  return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
}

function Kpi({ label, value, icon, tone = "purple", active, onClick }: { label: string; value: number; icon: string; tone?: string; active?: boolean; onClick: () => void }) { return <button className={`orders-kpi tone-${tone}${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}><span><small>{label}</small><strong>{value}</strong></span><i><UiIcon name={icon} /></i></button>; }
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <button className="orders-filter-chip" onClick={onRemove}>{label}<span aria-hidden="true">×</span></button>; }
function Detail({ label, value }: { label: string; value: ReactNode }) { return <div className="orders-detail"><small>{label}</small><strong>{value}</strong></div>; }
function MoneyLine({ label, value, currency, strong, success, danger, muted }: { label: string; value: number; currency: string; strong?: boolean; success?: boolean; danger?: boolean; muted?: boolean }) { return <div className={`orders-money-line${strong ? " strong" : ""}${success ? " success" : ""}${danger ? " danger" : ""}${muted ? " muted" : ""}`}><span>{label}</span><b>{money(value, currency)}</b></div>; }

function UiIcon({ name }: { name: string }) { const paths: Record<string, React.ReactNode> = { search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>, filter: <><path d="M4 5h16M7 12h10M10 19h4" /></>, settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.5 6A8 8 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.5 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></>, download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></>, chevronRight: <path d="m9 6 6 6-6 6" />, chevronLeft: <path d="m15 6-6 6 6 6" />, chevronDown: <path d="m6 9 6 6 6-6" />, warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4m0 3h.01" /></>, image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-5L5 20" /></>, bag: <><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>, payment: <><path d="M7 3h10v18H7z" /><path d="M10 7h4m-4 4h4m-5 6h6" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>, clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>, truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>, check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> }; return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.check}</svg>; }
function OrderChannelIcon({ channel }: { channel: string }) { const key = channel.toUpperCase(); if (key === "FACEBOOK") return <span className="orders-channel facebook" title="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4.3c-.5-.1-2-.3-3.8-.3C9.7 4 7.3 6.1 7.3 10v2H4v4h3.3v8h4V16h3.3l.5-4h-3.8v-1.6C11.3 8.8 11.7 8 14 8Z" /></svg></span>; if (key === "INSTAGRAM") return <span className="orders-channel instagram" title="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="7" r="1" /></svg></span>; if (key === "WHATSAPP") return <span className="orders-channel whatsapp" title="WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4A8 8 0 1 1 20 11.7Z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9 8c.5 3 2 4.5 5 5l1-1 2 1.5c-1 2-3 2-5.5.7A8 8 0 0 1 7.8 10C7.5 8.5 8 7.5 9 8Z" /></svg></span>; if (key === "EMAIL") return <span className="orders-channel email" title="Email"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg></span>; if (key === "CHATWOOT") return <span className="orders-channel chatwoot" title="Chatwoot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" /></svg></span>; return <span className="orders-channel manual" title={ui.manualChannel}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17-1 4 4-1L19 8l-3-3L4 17Z" /></svg></span>; }

function isActiveOrder(order: Order) { return !["COMPLETED", "CANCELLED"].includes(order.salesStatus); }
function isReadyToShip(order: Order) { return order.shippingStatus === "READY" || (order.productionStatus === "READY" && !["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(order.shippingStatus)); }
function paid(order: Order) { return order.payments.filter((payment) => payment.currency === order.currency).reduce((sum, payment) => sum + payment.amountMinor, 0); }
function balance(order: Order) { return Math.max(0, order.priceMinor - paid(order)); }
function itemQuantity(order: Order) { return order.items.reduce((sum, item) => sum + item.quantity, 0) || 1; }
function athleteCount(order: Order) { return new Set(order.items.map((item) => item.athlete?.id).filter(Boolean)).size || Number(Boolean(order.athlete)); }
function designPaths(order: Order) { const paths = order.items.map((item) => item.modelImagePath).filter((value): value is string => Boolean(value)); if (order.modelImagePath) paths.unshift(order.modelImagePath); return [...new Set(paths)]; }
function designCount(order: Order) { return Math.max(1, new Set(order.items.map((item) => item.modelImagePath || item.name)).size || designPaths(order).length); }
function quantitySummary(order: Order) { return `${itemQuantity(order)} ${ui.pieces}`; }
function OrderDesigns({ order, onPreview, onLeave }: { order: Order; onPreview: (event: ReactMouseEvent<HTMLImageElement>) => void; onLeave: () => void }) { const paths = designPaths(order); if (!paths.length) return <span className="orders-design-placeholder"><UiIcon name="image" /></span>; return <div className="orders-design-stack">{paths.slice(0, 3).map((path) => <img key={path} loading="lazy" src={`/api/orders/images/${path}`} alt={ui.orderDesignAlt} onMouseEnter={onPreview} onMouseMove={onPreview} onMouseLeave={onLeave} />)}{paths.length > 3 && <b>+{paths.length - 3}</b>}</div>; }
function orderProblems(order: Order) { const problems: string[] = []; if (days(order) < 0 && isActiveOrder(order)) problems.push(ui.problems.overdue); if (!hasMeasurements(order)) problems.push(ui.problems.dimensions); if (!order.client.address) problems.push(ui.problems.address); if (paid(order) < order.depositRequiredMinor && isActiveOrder(order)) problems.push(ui.problems.payment); if (!designPaths(order).length) problems.push(ui.problems.design); return problems; }
function nextOrderAction(order: Order): { label: string; detail?: string; tone: string; icon: string } { if (!hasMeasurements(order)) return { label: ui.actions.dimensions, tone: "amber", icon: "warning" }; if (!order.client.address && isReadyToShip(order)) return { label: ui.actions.address, tone: "red", icon: "warning" }; if (paid(order) < order.depositRequiredMinor) return { label: ui.actions.deposit, detail: money(order.depositRequiredMinor - paid(order), order.currency), tone: "amber", icon: "payment" }; if (["DESIGN_DISCUSSION", "WAITING_COACH_APPROVAL"].includes(order.salesStatus)) return { label: ui.actions.design, tone: "purple", icon: "image" }; if (order.productionStatus === "NOT_SCHEDULED") return { label: ui.actions.production, tone: "green", icon: "check" }; if (order.productionStatus === "READY" && balance(order) > 0) return { label: ui.actions.balance, detail: money(balance(order), order.currency), tone: "amber", icon: "payment" }; if (isReadyToShip(order)) return { label: ui.actions.shipping, tone: "green", icon: "truck" }; return { label: ui.actions.none, tone: "muted", icon: "check" }; }
function hasMeasurements(order: Order) { if (order.type === "GROUP_ORDER" || order.type === "PAIR" || order.items.length > 1) return order.items.length > 0 && order.items.every((item) => Boolean(item.measurement)); return Boolean(order.measurement || order.items[0]?.measurement); }
function primaryMeasurement(order: Order) { return order.measurement || order.items[0]?.measurement; }
function measurementAthlete(order: Order) { return order.athlete || order.items[0]?.athlete; }
function measurementSizes(values?: Record<string, number>) { if (!values) return ui.notReceived; const height = values.standardHeight ? `${values.standardHeight} / ` : ""; return `${height}${[values.m1, values.m2, values.m3, values.m15].map((value) => value ?? "—").join(" / ")} см`; }
function discipline(value?: string) { const codes: Record<string, string> = { RHYTHMIC_GYMNASTICS: "RG", ACROBATIC_GYMNASTICS: "ACRO", FIGURE_SKATING: "FS", AEROBIC_GYMNASTICS: "AERO", BATON_TWIRLING_MAJORETTE: "TW", OTHER: "—" }; const labels = ui.disciplines as Record<string, string>; return { code: codes[value || ""] || "—", label: labels[value || ""] || ui.disciplines.missing }; }
function carrierLabel(value: string) { return (ui.carriers as Record<string, string>)[value] || value; }
function statusTone(status: string) { if (["CANCELLED", "LOST"].includes(status)) return "danger"; if (["WAITING_DEPOSIT", "WAITING_FINAL_PAYMENT", "MEASUREMENTS_REQUIRED", "ON_HOLD"].includes(status)) return "warning"; if (["PAID", "READY", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"].includes(status)) return "success"; if (["NEW_LEAD", "NOT_SCHEDULED"].includes(status)) return "info"; return "violet"; }
function money(value: number, currency: string) { return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(value / 100); }
function days(order: Order) { return order.requiredDeliveryAt ? Math.ceil((new Date(order.requiredDeliveryAt).getTime() - Date.now()) / 86400000) : 9999; }
function date(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function deliveryDate(order: Order) { return order.requiredDeliveryAt ? date(order.requiredDeliveryAt) : ui.notSpecified; }
function dayText(order: Order) { const value = days(order); return value === 9999 ? ui.noDeadline : value < 0 ? `${ui.overdueBy} ${Math.abs(value)} ${ui.daysShort}` : value === 0 ? ui.today : `${ui.inDays} ${value} ${ui.daysShort}`; }
function ageText(value: string) { const count = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)); return count === 0 ? ui.today : `${count} ${ui.daysAgo}`; }
function deliveryPlace(order: Order) { return [order.country || order.client.country, order.client.city, order.client.address].filter(Boolean).join(", ") || ui.addressMissing; }
function countryCode(country?: string) { if (!country) return ""; const normalized = country.trim(); const prefixedCode = normalized.toUpperCase().match(/^([A-Z]{2})(?:\s|$)/)?.[1]; const aliases: Record<string, string> = { ukraine: "UA", украина: "UA", україна: "UA", france: "FR", франция: "FR", italy: "IT", италия: "IT", spain: "ES", испания: "ES", germany: "DE", германия: "DE", netherlands: "NL", нидерланды: "NL", poland: "PL", польша: "PL", usa: "US", "united states": "US", "united kingdom": "GB", britain: "GB" }; return prefixedCode || aliases[normalized.toLocaleLowerCase("ru")] || (normalized.length === 2 ? normalized.toUpperCase() : ""); }
function countryLabel(country?: string) { return country?.trim().replace(/^[A-Z]{2}\s+/i, "") || ""; }
function quickFilterLabel(value: QuickFilter) { return ({ active: ui.kpis.active, urgent: ui.urgent, deposit: ui.withoutDeposit, work: ui.inWork, ready: ui.ready, completed: ui.kpis.completed, overdue: ui.kpis.overdue, all: ui.all })[value]; }
