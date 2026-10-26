"use client";
import { dataEvidenceUi } from "../lib/i18n";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ActionIcon, Badge, Collapse, HoverCard, Menu, NumberInput, SegmentedControl, Select, TextInput, Tooltip, alpha, useMantineTheme, type MantineTheme } from "@mantine/core";
import { labels, productionUi } from "../lib/i18n";
import {
  paymentPresentation,
  productionDayDiff,
  productionIso,
  productionLocalDate,
  productionOrderImage,
  productionOrderIsShipped,
  productionStatusForDisplay,
  productionOrderQuantity,
  productionSlotTimingPresentation,
  shippingPresentation,
  type ProductionFilters,
  type ProductionOrderView,
  type ProductionRangeMode,
  type ProductionSlotView,
  type ProductionSortMode,
} from "../lib/production-view";
import { CrmButton } from "./crm/settings-controls";
import { CrmStatusBadge, crmStatusPresentation } from "./crm/status-badge";

const PAYMENT_COLORS: Record<ReturnType<typeof paymentPresentation>["code"],string> = { unknown:"gray",unpaid:"red",partial:"yellow",deposit:"green",paid:"green",refunded:"orange",cancelled:"gray" };
const SHIPPING_COLORS: Record<ReturnType<typeof shippingPresentation>["code"],string> = {none:"gray",planned:"cyan",shipped:"green",delivered:"teal",returned:"orange",lost:"red"};
function productionStatusStyle(theme:MantineTheme,color:string):CSSProperties {
  const palette=theme.colors[color] ?? theme.colors.gray!;
  return {"--production-status-background":alpha(palette[6]!,0.15),"--production-status-text":palette[9],"--production-status-border":palette[3]} as CSSProperties;
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const COUNTRY_CODES: Record<string, string> = { ukraine: "UA", украина: "UA", україна: "UA", usa: "US", "united states": "US", "united states of america": "US", "united kingdom": "GB", britain: "GB", "czech republic": "CZ", uae: "AE" };
const DISPLAYED_COUNTRIES = (() => {
  const result = new Map<string, string>();
  const displays = ["en", "ru", "uk"].map((locale) => new Intl.DisplayNames([locale], { type: "region" }));
  for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
    const code = String.fromCharCode(first, second);
    for (const display of displays) {
      const name = display.of(code);
      if (name && name !== code) result.set(name.trim().toLocaleLowerCase(), code);
    }
  }
  return result;
})();

function countryCode(country?: string) {
  if (!country) return "";
  const normalized = country.trim();
  const prefixed = normalized.toUpperCase().match(/^([A-Z]{2})(?:\s|$)/)?.[1];
  const key = normalized.toLocaleLowerCase();
  return prefixed || COUNTRY_CODES[key] || DISPLAYED_COUNTRIES.get(key) || (normalized.length === 2 ? normalized.toUpperCase() : "");
}

export function countryFlag(country?: string) {
  const code = countryCode(country);
  return code ? [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("") : "🌍";
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(productionLocalDate(value)) : productionUi.noDeadline;
}

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(minor / 100);
}

function paymentLabel(code: ReturnType<typeof paymentPresentation>["code"]) {
  return ({ unknown: dataEvidenceUi.unavailable, unpaid: productionUi.paymentUnpaid, partial: productionUi.paymentPartial, deposit: productionUi.paymentDeposit, paid: productionUi.paymentPaid, refunded: productionUi.paymentRefunded, cancelled: productionUi.paymentCancelled })[code];
}

function shippingLabel(code: ReturnType<typeof shippingPresentation>["code"]) {
  return ({ none: productionUi.noDeadline, planned: productionUi.shippingPlanned, tracking: productionUi.shippingTracking, shipped: productionUi.shippingShipped, delivered: productionUi.shippingDelivered, returned: productionUi.shippingReturned, lost: productionUi.shippingLost })[code];
}

function productionLabel(status: string) {
  return labels.productionStatus[status as keyof typeof labels.productionStatus] || status;
}

export function ProductionHeader({ periodLabel, mode, onMode, onPrevious, onNext, onToday, onCreateOrder, canCreateOrder }: {
  periodLabel: string;
  mode: ProductionRangeMode;
  onMode: (mode: ProductionRangeMode) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreateOrder?: () => void;
  canCreateOrder: boolean;
}) {
  return <header className="production-heading">
    <div className="production-heading-copy"><h1>{productionUi.title}</h1><p>{productionUi.subtitle}</p></div>
    <div className="production-period-controls">
      <ActionIcon variant="default" aria-label={productionUi.previousPeriod} onClick={onPrevious}>‹</ActionIcon>
      <ActionIcon variant="default" aria-label={productionUi.nextPeriod} onClick={onNext}>›</ActionIcon>
      <CrmButton tone="secondary" onClick={onToday}>{productionUi.today}</CrmButton>
      <strong>{periodLabel}</strong>
    </div>
    <div className="production-heading-actions">
      <SegmentedControl value={mode} onChange={(value) => onMode(value as ProductionRangeMode)} data={[
        { value: "day", label: productionUi.rangeDay },
        { value: "week", label: productionUi.rangeWeek },
        { value: "month", label: productionUi.rangeMonth },
        { value: "twoMonths", label: productionUi.rangeTwoMonths },
      ]}/>
      {canCreateOrder && onCreateOrder && <CrmButton onClick={onCreateOrder}>{productionUi.newOrder}</CrmButton>}
    </div>
  </header>;
}

export function ProductionKpis({ metrics, capacity }: {
  metrics: { total: number; scheduled: number; depositReceived: number; awaitingPayment: number; averagePercent: number; peakPercent: number; nextWindow: string | null; dailyLoad: number[] };
  capacity: number;
}) {
  const percent = (value: number) => metrics.total ? Math.round(value / metrics.total * 100) : 0;
  return <section className="production-kpis" aria-label={productionUi.loadTitle}>
    <article className="production-kpi"><span className="production-kpi-icon is-blue">▣</span><div><small>{productionUi.ordersInProduction}</small><strong>{metrics.scheduled} <em>{productionUi.loadedOrders} {metrics.total}</em></strong></div></article>
    <article className="production-kpi"><span className="production-kpi-icon is-green">✓</span><div><small>{productionUi.depositReceived}</small><strong>{metrics.depositReceived} <em>{percent(metrics.depositReceived)}%</em></strong></div></article>
    <article className="production-kpi"><span className="production-kpi-icon is-gray">▣</span><div><small>{productionUi.awaitingPayment}</small><strong>{metrics.awaitingPayment} <em>{percent(metrics.awaitingPayment)}%</em></strong></div></article>
    <article className="production-kpi"><span className="production-kpi-icon is-blue">▦</span><div><small>{productionUi.freeWindow}</small><strong>{metrics.nextWindow ? formatDate(metrics.nextWindow) : productionUi.notCalculated}</strong></div></article>
    <article className="production-kpi production-kpi-load"><div><small>{productionUi.loadTitle}</small><div className="production-load-spark" aria-hidden="true">{metrics.dailyLoad.slice(0, 22).map((value, index) => <i key={index} className={value > capacity ? "over" : value === capacity ? "full" : ""} style={{ height: `${Math.max(16, Math.min(100, value / capacity * 100))}%` }}/>)}</div></div><dl><div><dt>{productionUi.average}</dt><dd>{metrics.averagePercent}%</dd></div><div><dt>{productionUi.peak}</dt><dd>{metrics.peakPercent}%</dd></div></dl></article>
  </section>;
}

export function ProductionFiltersBar({ filters, opened, sortMode, capacity, previewWidth, onSortMode, onCapacity, onPreviewWidth, onToggle, onChange, onReset }: {
  filters: ProductionFilters;
  opened: boolean;
  sortMode: ProductionSortMode;
  capacity: number;
  previewWidth: number;
  onSortMode: (mode: ProductionSortMode) => void;
  onCapacity: (value: number) => void;
  onPreviewWidth: (value: number) => void;
  onToggle: () => void;
  onChange: (filters: ProductionFilters) => void;
  onReset: () => void;
}) {
  return <div className="production-filter-shell">
    <div className="production-filter-primary">
      <TextInput value={filters.query} onChange={(event) => onChange({ ...filters, query: event.currentTarget.value })} placeholder={productionUi.search} aria-label={productionUi.search} leftSection="⌕"/>
      <CrmButton tone="secondary" aria-expanded={opened} onClick={onToggle}>☷ {productionUi.filters}</CrmButton>
      <label className="production-sort-control"><span>{productionUi.sortOrders}</span><Select aria-label={productionUi.sortOrders} value={sortMode} onChange={(value) => onSortMode((value || "schedule") as ProductionSortMode)} allowDeselect={false} data={[{ value: "schedule", label: productionUi.sortSchedule }, { value: "shippingProximity", label: productionUi.sortShippingProximity }]}/></label>
      <label className="production-capacity-control"><span>{productionUi.loadTitle}</span><Select aria-label={productionUi.slotsPerDay} value={String(capacity)} onChange={(value) => value && onCapacity(Number(value))} allowDeselect={false} data={[1, 2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: `${value} ${productionUi.slotsPerDay}` }))}/></label>
    </div>
    <Collapse expanded={opened}><div className="production-filter-grid">
      <Select aria-label={productionUi.payment} value={filters.payment} onChange={(value) => onChange({ ...filters, payment: (value || "all") as ProductionFilters["payment"] })} allowDeselect={false} data={[
        { value: "all", label: productionUi.paymentAll }, { value: "unpaid", label: productionUi.paymentUnpaid }, { value: "partial", label: productionUi.paymentPartial }, { value: "deposit", label: productionUi.paymentDeposit }, { value: "paid", label: productionUi.paymentPaid },
      ]}/>
      <Select aria-label={productionUi.stage} value={filters.production} onChange={(value) => onChange({ ...filters, production: value || "all" })} allowDeselect={false} data={[{ value: "all", label: productionUi.productionAll }, ...Object.entries(labels.productionStatus).filter(([value]) => value !== "CANCELLED").map(([value, label]) => ({ value, label }))]}/>
      <Select aria-label={productionUi.shippingSegment} value={filters.shipping} onChange={(value) => onChange({ ...filters, shipping: (value || "all") as ProductionFilters["shipping"] })} allowDeselect={false} data={[{ value: "all", label: productionUi.shippingAll }, { value: "planned", label: productionUi.shippingPlanned }, { value: "tracking", label: productionUi.shippingTracking }, { value: "shipped", label: productionUi.shippingShipped }, { value: "delivered", label: productionUi.shippingDelivered }, { value: "returned", label: productionUi.shippingReturned }, { value: "lost", label: productionUi.shippingLost }]}/>
      <Select aria-label={productionUi.productionPeriod} value={filters.slot} onChange={(value) => onChange({ ...filters, slot: (value || "all") as ProductionFilters["slot"] })} allowDeselect={false} data={[{ value: "all", label: productionUi.slotAll }, { value: "tentative", label: productionUi.slotTentative }, { value: "confirmed", label: productionUi.slotConfirmed }, { value: "locked", label: productionUi.slotLocked }]}/>
      <Select aria-label={productionUi.deadlineOverdue} value={filters.deadline} onChange={(value) => onChange({ ...filters, deadline: (value || "all") as ProductionFilters["deadline"] })} allowDeselect={false} data={[{ value: "all", label: productionUi.deadlineAll }, { value: "overdue", label: productionUi.deadlineOverdue }]}/>
      <NumberInput aria-label={productionUi.previewWidth} value={previewWidth} onChange={(value) => typeof value === "number" && onPreviewWidth(value)} min={200} max={1200} step={50} suffix=" px"/>
      <CrmButton tone="secondary" onClick={onReset}>{productionUi.resetFilters}</CrmButton>
    </div></Collapse>
  </div>;
}

type PreviewPayload = { src: string; x: number; y: number; country: string; quantity: number; total: string };

export function ProductionTimeline({ orders, days, base, dayWidth, capacity, selectedId, onSelect, onDrag, onToggleLock, onSchedule, onPreview }: {
  orders: ProductionOrderView[];
  days: Date[];
  base: Date;
  dayWidth: number;
  capacity: number;
  selectedId?: string;
  onSelect: (orderId: string) => void;
  onDrag: (order: ProductionOrderView, edge: "move" | "left" | "right", event: ReactPointerEvent) => void;
  onToggleLock: (order: ProductionOrderView) => void;
  onSchedule: (order: ProductionOrderView) => void;
  onPreview: (preview?: PreviewPayload) => void;
}) {
  const scheduled = orders.filter((order) => order.productionSlot);
  const unscheduled = orders.filter((order) => !order.productionSlot);
  const dailyLoad = days.map((day) => scheduled.filter((order) => day >= productionLocalDate(order.productionSlot!.startsAt) && day <= productionLocalDate(order.productionSlot!.endsAt)).length);
  const weeks = days.reduce<{ start: number; length: number; label: string }[]>((groups, day, index) => {
    if (index % 7 === 0) {
      const end = days[Math.min(days.length - 1, index + 6)]!;
      groups.push({ start: index, length: Math.min(7, days.length - index), label: `${day.getDate()} ${MONTHS[day.getMonth()]!.toLocaleLowerCase()} – ${end.getDate()} ${MONTHS[end.getMonth()]!.toLocaleLowerCase()}` });
    }
    return groups;
  }, []);
  const gridStyle = { "--timeline-days": days.length, "--day-width": `${dayWidth}px` } as CSSProperties;
  return <section className="production-board" aria-label={productionUi.title}>
    <div className="production-board-scroll">
      <div className="production-board-canvas" style={gridStyle}>
        <div className="production-calendar-header">
          <div className="production-week-row"><div className="production-load-heading">{productionUi.loadTitle} · {capacity}/{productionUi.daysShort}</div>{weeks.map((week) => <strong key={week.start} style={{ gridColumn: `${week.start + 2}/${week.start + week.length + 2}` }}>{week.label}</strong>)}</div>
          <div className="production-day-row"><div/><>{days.map((day) => { const today = productionIso(day) === productionIso(new Date()); const weekend = day.getDay() === 0 || day.getDay() === 6; return <span key={productionIso(day)} className={`${today ? "today" : ""} ${weekend ? "weekend" : ""}`}><small>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(day)}</small><b>{day.getDate()}</b>{today && <em>{productionUi.today}</em>}</span>; })}</></div>
          <div className="production-load-row"><div className="production-order-columns-head"><span>{productionUi.orderClient}</span><span>{productionUi.modelDescription}</span><span>{productionUi.payment}</span><span>{productionUi.shippingShort}</span></div>{dailyLoad.map((value, index) => <span key={index} className={value > capacity ? "over" : value === capacity ? "full" : ""}><i style={{ width: `${Math.min(100, value / capacity * 100)}%` }}/><small>{value}/{capacity}</small></span>)}</div>
        </div>
        {orders.map((order) => order.productionSlot
          ? <TimelineOrderRow key={order.id} order={order} days={days} base={base} selected={selectedId === order.id} onSelect={() => onSelect(order.id)} onDrag={onDrag} onToggleLock={() => onToggleLock(order)} onPreview={onPreview}/>
          : <div className={`production-order-row is-unscheduled ${selectedId === order.id ? "is-selected" : ""}`} key={order.id}><OrderSummary order={order} onSelect={() => onSelect(order.id)}/><CrmButton className="production-schedule-order" tone="secondary" onClick={() => onSchedule(order)}>+ {productionUi.schedule}</CrmButton></div>)}
        {!orders.length && <div className="production-empty-state">{productionUi.noOrders}</div>}
      </div>
    </div>
  </section>;
}

function TimelineOrderRow({ order, days, base, selected, onSelect, onDrag, onToggleLock, onPreview }: {
  order: ProductionOrderView;
  days: Date[];
  base: Date;
  selected: boolean;
  onSelect: () => void;
  onDrag: (order: ProductionOrderView, edge: "move" | "left" | "right", event: ReactPointerEvent) => void;
  onToggleLock: () => void;
  onPreview: (preview?: PreviewPayload) => void;
}) {
  const theme=useMantineTheme();
  const slot = order.productionSlot!;
  const start = productionDayDiff(slot.startsAt, base);
  const end = productionDayDiff(slot.endsAt, base);
  const shipping = shippingPresentation(order);
  const shippingDay = shipping.date ? productionDayDiff(shipping.date, base) : undefined;
  const payment = paymentPresentation(order);
  const isSent = productionOrderIsShipped(order);
  const stageColor=crmStatusPresentation("production",productionStatusForDisplay(order)).color;
  const shippingCaption=isSent?shippingLabel(shipping.code):productionUi.shippingSegment;
  const timing = productionSlotTimingPresentation(order)!;
  const duration = timing.duration;
  const shippingGap = shippingDay === undefined ? undefined : shippingDay - end;
  return <div className={`production-order-row ${selected ? "is-selected" : ""}`}>
    <OrderSummary order={order} onSelect={onSelect} onPreview={onPreview}/>
    {end >= 0 && start < days.length && <HoverCard withinPortal shadow="md" openDelay={350} closeDelay={100} position="top" withArrow>
      <HoverCard.Target><button type="button" className={`timeline-bar production-flow-bar production-status-color ${slot.tentative ? "tentative" : ""} ${slot.locked ? "locked" : ""} ${isSent ? "is-sent" : order.hasTrackingNumber ? "is-tracked" : ""}`} style={{...productionStatusStyle(theme,isSent?SHIPPING_COLORS[shipping.code]:stageColor), gridColumn: `${Math.max(0, start) + 2}/${Math.min(days.length, end + 1) + 2}` }} onClick={(event) => { if (event.currentTarget.dataset.dragged !== "true") onSelect(); }} onPointerDown={(event) => onDrag(order, "move", event)} aria-label={isSent ? `${order.number}: ${shippingCaption}` : `${order.number}: ${paymentLabel(payment.code)}, ${productionLabel(productionStatusForDisplay(order))}, ${shippingLabel(shipping.code)}`}>
        <span className="resize left" onPointerDown={(event) => { event.stopPropagation(); onDrag(order, "left", event); }}/>
        {isSent ? <span className="timeline-shipped-segment production-status-color"><b>{shippingCaption}</b></span> : <><span className={`timeline-payment-segment production-status-color is-${payment.code}`} style={productionStatusStyle(theme,PAYMENT_COLORS[payment.code])}>▣ <b>{paymentLabel(payment.code)}</b></span><span className="timeline-production-segment production-status-color" data-status={productionStatusForDisplay(order)} style={productionStatusStyle(theme,stageColor)}>♙ <b>{productionLabel(productionStatusForDisplay(order))}</b><small>{duration} {productionUi.daysShort}</small></span></>}
        {slot.locked && <span className="timeline-lock-indicator" aria-label={productionUi.slotLocked}>🔒</span>}
        {!isSent && order.hasTrackingNumber && <span className="timeline-tracking-indicator">{productionUi.trackingAvailable}</span>}
        <span className="resize right" onPointerDown={(event) => { event.stopPropagation(); onDrag(order, "right", event); }}/>
      </button></HoverCard.Target>
      <HoverCard.Dropdown className="production-slot-preview"><strong>{order.number} · {order.client.displayName}</strong><dl><div><dt>{productionUi.stage}</dt><dd>{isSent ? shippingCaption : productionLabel(productionStatusForDisplay(order))}</dd></div><div><dt>{productionUi.startDate}</dt><dd>{formatDate(slot.startsAt)}</dd></div><div><dt>{productionUi.endDate}</dt><dd>{formatDate(slot.endsAt)}</dd></div><div><dt>{productionUi.totalDuration}</dt><dd>{duration} {productionUi.daysShort}</dd></div><div><dt>{timing.code === "completed" ? productionUi.productionCompleted : timing.code === "overdue" ? productionUi.productionOverdue : productionUi.remainingProduction}</dt><dd>{timing.days} {productionUi.daysShort}</dd></div></dl></HoverCard.Dropdown>
    </HoverCard>}
    {shippingGap !== undefined && shippingGap > 0 && end >= 0 && shippingDay !== undefined && <span className={`timeline-shipping-segment production-status-color is-${shipping.code}`} style={{...productionStatusStyle(theme,SHIPPING_COLORS[shipping.code]), gridColumn: `${Math.max(0, end + 1) + 2}/${Math.min(days.length, shippingDay + 1) + 2}` }}><b>🚚</b><span>{shippingCaption}</span></span>}
    {shippingDay !== undefined && shippingDay >= 0 && shippingDay < days.length && <Tooltip label={`${shippingLabel(shipping.code)}: ${formatDate(shipping.date)}`}><span className={`shipping-date-marker production-status-color is-${shipping.code}`} style={{...productionStatusStyle(theme,SHIPPING_COLORS[shipping.code]), gridColumn: `${shippingDay + 2}/${shippingDay + 3}` }}><b>🚚</b><small>{productionLocalDate(shipping.date!).getDate()}</small></span></Tooltip>}
    <Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon className="timeline-row-menu" variant="subtle" aria-label={`${order.number}: ${productionUi.filters}`}>⋮</ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item onClick={onSelect}>{productionUi.selectedOrder}</Menu.Item><Menu.Item onClick={onToggleLock}>{slot.locked ? productionUi.unlockSlot : productionUi.lockSlot}</Menu.Item></Menu.Dropdown></Menu>
  </div>;
}

function OrderSummary({ order, onSelect, onPreview }: { order: ProductionOrderView; onSelect: () => void; onPreview?: (preview?: PreviewPayload) => void }) {
  const image = productionOrderImage(order);
  const payment = paymentPresentation(order);
  const quantity = productionOrderQuantity(order);
  const shipping = shippingPresentation(order);
  const model = order.items.map((item) => item.name).filter(Boolean).join(", ") || order.notes || productionUi.noDescription;
  return <button type="button" className="production-order-summary" onClick={onSelect}>
    <span className="production-order-main">{image ? <img src={image} alt={productionUi.modelImage} onMouseMove={(event) => onPreview?.({ src: event.currentTarget.src, x: event.clientX, y: event.clientY, country: `${countryFlag(order.client.country)} ${order.client.country || productionUi.countryMissing}`, quantity, total: formatMoney(order.priceMinor, order.currency) })} onMouseLeave={() => onPreview?.(undefined)}/> : <i>{productionUi.modelFallback}</i>}<span><strong>{order.number}</strong><small>{countryFlag(order.client.country)} {order.client.country || productionUi.countryMissing}</small></span></span>
    <span className="production-order-description"><b>{order.client.displayName}</b><small title={model}>{model}</small>{quantity > 1 && <em>{quantity} {productionUi.pieces}</em>}</span>
    <Badge variant="light" component="span" radius="sm" size="sm" color={PAYMENT_COLORS[payment.code]} className={`production-payment-badge is-${payment.code}`}>{paymentLabel(payment.code)}</Badge>
    <span className="production-order-shipping">{productionOrderIsShipped(order) || ["lost","returned"].includes(shipping.code) ? <Tooltip label={`${shippingLabel(shipping.code)}: ${formatDate(shipping.date)}`}><Badge variant="light" component="span" radius="sm" size="xs" color={SHIPPING_COLORS[shipping.code]}>{order.partiallyShipped ? `${productionUi.shippingPartial} · ${shippingLabel(shipping.code)}` : shippingLabel(shipping.code)}</Badge></Tooltip> : formatDate(order.requiredDeliveryAt)}</span>
  </button>;
}

export function ProductionOrderDetails({ order, onClose, onOpenOrder, onSaveSlot, onSaveDeadline, canEdit, onDeleteSlot }: {
  order: ProductionOrderView;
  onClose: () => void;
  onOpenOrder?: () => void;
  onSaveSlot: (slot: ProductionSlotView) => void;
  onSaveDeadline: (requiredDeliveryAt: string) => void;
  canEdit: boolean;
  onDeleteSlot: () => void;
}) {
  const image = productionOrderImage(order);
  const quantity = productionOrderQuantity(order);
  const payment = paymentPresentation(order);
  const shipping = shippingPresentation(order);
  const productionCompleted = productionOrderIsShipped(order) && order.productionStatus !== "CANCELLED";
  const remaining = shipping.date ? productionDayDiff(shipping.date, new Date()) : null;
  const images = [...new Set([order.modelImagePath, ...order.items.map((item) => item.modelImagePath)].filter((value): value is string => Boolean(value)))];
  return <aside className="production-order-details" aria-label={`${productionUi.selectedOrder}: ${order.number}`}>
    <button type="button" className="production-details-close" aria-label={productionUi.closeDetails} onClick={onClose}>×</button>
    <section className="production-details-identity">{image ? <img src={image} alt={productionUi.modelImage}/> : <i>{productionUi.modelFallback}</i>}<div><small>{productionUi.selectedOrder}</small><h2>{order.number}</h2><b>{countryFlag(order.client.country)} {order.client.displayName}</b><p>{order.items.map((item) => item.name).filter(Boolean).join(", ") || order.notes || productionUi.noDescription}</p><span>{productionUi.items}: {quantity} {productionUi.pieces}</span></div></section>
    <section className="production-lifecycle">
      <div className={`is-${payment.code}`}><span>✓</span><b>{productionUi.lifecyclePayment}</b><Badge variant="light" component="small" color={PAYMENT_COLORS[payment.code]} radius="sm" size="sm">{paymentLabel(payment.code)}</Badge><em>{formatMoney(order.priceMinor, order.currency)} / {order.paymentSettlementKnown === false ? dataEvidenceUi.unavailable : formatMoney(order.paidMinor, order.currency)}</em></div>
      <div className={productionCompleted ? "is-completed" : `is-${productionStatusForDisplay(order).toLocaleLowerCase()}`}><span>♙</span><b>{productionUi.lifecycleProduction}</b><Badge variant="light" component="small" color={productionCompleted ? "green" : crmStatusPresentation("production",productionStatusForDisplay(order)).color} radius="sm" size="sm">{productionCompleted ? productionUi.productionFulfilled : productionLabel(productionStatusForDisplay(order))}</Badge><em>{order.productionSlot ? `${formatDate(order.productionSlot.startsAt)} – ${formatDate(order.productionSlot.endsAt)}` : "—"}{order.productionSlot?.tentative && !productionCompleted ? ` · ${productionUi.slotTentative}` : ""}</em></div>
      <div className={`is-${shipping.code}`}><span>🚚</span><b>{productionUi.lifecycleShipping}</b><Badge variant="light" component="small" color={SHIPPING_COLORS[shipping.code]} radius="sm" size="sm">{order.partiallyShipped ? `${productionUi.shippingPartial} · ${shippingLabel(shipping.code)}` : shippingLabel(shipping.code)}</Badge><em>{shipping.date ? formatDate(shipping.date) : order.partiallyShipped ? productionUi.shippingPartial : order.hasTrackingNumber ? productionUi.shippingConfirmedByTracking : "—"}</em></div>
    </section>
    <section className="production-details-dates"><h3>{productionUi.productionPeriod}</h3>{order.productionSlot ? <>
      <label>{productionUi.startDate}<input type="date" value={productionIso(order.productionSlot.startsAt)} onChange={(event) => onSaveSlot({ ...order.productionSlot!, startsAt: event.currentTarget.value })}/></label>
      <label>{productionUi.endDate}<input type="date" value={productionIso(order.productionSlot.endsAt)} onChange={(event) => onSaveSlot({ ...order.productionSlot!, endsAt: event.currentTarget.value })}/></label>
    </> : <p>{productionUi.noProductionSlot}</p>}{canEdit ? <label>{productionUi.plannedShipping}<input type="date" value={order.requiredDeliveryAt ? productionIso(order.requiredDeliveryAt) : ""} onChange={(event) => onSaveDeadline(event.currentTarget.value)}/></label> : <dl><div><dt>{productionUi.plannedShipping}</dt><dd>{formatDate(order.requiredDeliveryAt)}</dd></div></dl>}<dl><div><dt>{productionUi.actualShipping}</dt><dd>{order.shippedAt ? formatDate(order.shippedAt) : order.partiallyShipped ? productionUi.shippingPartial : order.hasTrackingNumber ? productionUi.shippingConfirmedByTracking : formatDate(null)}</dd></div><div><dt>{productionUi.remaining}</dt><dd>{remaining === null ? "—" : `${remaining} ${productionUi.daysShort}`}</dd></div></dl>{productionCompleted ? <Badge color="green" variant="light" radius="xl">{productionUi.productionFulfilled}</Badge> : <CrmStatusBadge domain="production" status={productionStatusForDisplay(order)}/>}</section>
    <section className="production-details-notes"><h3>{productionUi.orderNotes}</h3><p>{order.notes || productionUi.noNotes}</p><h3>{productionUi.orderImages} ({images.length})</h3><div>{images.map((name) => <img key={name} src={`/api/orders/images/${name}`} alt={productionUi.modelImage}/>)}{!images.length && <small>{productionUi.noImages}</small>}</div></section>
    <section className="production-details-actions"><h3>{productionUi.selectedOrder}</h3>{onOpenOrder && <CrmButton onClick={onOpenOrder}>{productionUi.openOrder}</CrmButton>}{order.productionSlot && <CrmButton tone="secondary" onClick={() => onSaveSlot({ ...order.productionSlot!, locked: !order.productionSlot!.locked })}>{order.productionSlot.locked ? productionUi.unlockSlot : productionUi.lockSlot}</CrmButton>}{order.productionSlot && <CrmButton color="red" tone="secondary" onClick={onDeleteSlot}>{productionUi.deleteSlot}</CrmButton>}</section>
  </aside>;
}
