"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { ActionIcon, Button, Select, Tooltip } from "@mantine/core";
import type { SalesGroup, SalesMetric } from "../../api/src/overview/sales-statistics.types";
import { moneyLabel } from "../lib/finance-report";
import { salesStatisticsUi } from "../lib/i18n";
import { salesWorldCountries, salesWorldIso2 } from "../lib/sales-statistics-world";
import "../app/sales-statistics-map.css";

const ui = salesStatisticsUi.map;
const ISO2 = new Set(salesWorldIso2);
const countryNames = new Intl.DisplayNames(["ru"], { type: "region" });
const counts = new Intl.NumberFormat("ru-RU");
const colors = ["#eae3ff", "#d4c2ff", "#b596ff", "#9061f5", "#6630dc"] as const;
const neutral = "#f0eef7";
const missing = "#c9cad3";

/** Validate against ISO, including countries absent from the 110m geometry. */
export function salesMapIso2(value: string | null): string | null {
  const code = value?.trim().toUpperCase();
  return code && ISO2.has(code) ? code : null;
}

export function salesMapValue(group: SalesGroup, metric: SalesMetric): number | null {
  return metric === "amount" ? group.amountMinor : group[metric];
}

/** Monetary thresholds stay in integer minor units; labels use moneyLabel. */
export function salesMapThresholds(groups: SalesGroup[], metric: SalesMetric): number[] {
  if (metric === "orders") return [5, 10, 20, 50];
  const maximum = groups.reduce((max, group) => Math.max(max, salesMapValue(group, metric) ?? 0), 0);
  const unit = metric === "amount" ? 100 : 1;
  const step = Math.max(unit, Math.ceil(maximum / 5 / unit) * unit);
  return [step, step * 2, step * 3, step * 4];
}

export function salesMapColor(value: number | null, thresholds: number[]): string {
  if (value === null) return missing;
  if (value <= 0) return neutral;
  const index = thresholds.findIndex(limit => value <= limit);
  return colors[index < 0 ? 4 : index]!;
}

export type SalesWorldMapProps = {
  groups: SalesGroup[];
  metric: SalesMetric;
  currency: string;
  onCountry: (code: string) => void;
};

export function SalesWorldMap({ groups, metric, currency, onCountry }: SalesWorldMapProps) {
  const legendId = useId();
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<readonly [number, number]>([265, 95]);
  const { byCode, known, unknown } = useMemo(() => {
    const byCode = new Map<string, SalesGroup>();
    const known: SalesGroup[] = [], unknown: SalesGroup[] = [];
    for (const group of groups) {
      const code = salesMapIso2(group.country);
      if (code) { byCode.set(code, group); known.push(group); }
      else if (salesMapValue(group, metric) === null || (salesMapValue(group, metric) ?? 0) > 0) unknown.push(group);
    }
    return { byCode, known, unknown };
  }, [groups, metric]);
  const thresholds = useMemo(() => salesMapThresholds(known, metric), [known, metric]);
  const units = metric === "amount" ? `${ui.amount} (${currency})` : ui[metric];
  const valueLabel = (value: number) => metric === "amount" ? moneyLabel(value, currency) : counts.format(value);
  const rangeLabel = (index: number) => {
    const previous = thresholds[index - 1];
    const current = thresholds[index];
    if (current === undefined) return `> ${valueLabel(previous!)}`;
    // Amounts can have fractions: avoid presenting gaps between monetary bins.
    if (metric === "amount") return `${previous === undefined ? "> 0" : `> ${valueLabel(previous)}`} – ${valueLabel(current)}`;
    return `${counts.format(previous === undefined ? 1 : previous + 1)}–${counts.format(current)}`;
  };
  const x = Math.max(0, Math.min(530 - 530 / zoom, center[0] - 265 / zoom));
  const y = Math.max(0, Math.min(190 - 190 / zoom, center[1] - 95 / zoom));
  const activate = (event: KeyboardEvent<SVGPathElement>, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCountry(code);
    }
  };
  const details = (label: string, group: SalesGroup | undefined) => <span className="sales-map-tooltip">
    <strong>{label}</strong>
    {group ? <>
      <span>{ui.orders}: <b>{counts.format(group.orders)}</b></span>
      <span>{ui.pieces}: <b>{counts.format(group.pieces)}</b></span>
      <span>{ui.amount}: <b>{group.amountMinor === null ? ui.noData : moneyLabel(group.amountMinor, currency)}</b></span>
      <span>{ui.average}: <b>{group.averageMinor === null ? ui.noData : moneyLabel(group.averageMinor, currency)}</b></span>
      <span>{ui.clients}: <b>{counts.format(group.clients)}</b></span>
    </> : <span>{ui.noData}</span>}
    <span className="sales-map-tooltip-action">{ui.openOrders} →</span>
  </span>;

  return <span className="sales-map">
    <span className="sales-map-stage">
      <svg className="sales-map-svg" viewBox={`${x} ${y} ${530 / zoom} ${190 / zoom}`}
        role="group" aria-label={ui.country} aria-describedby={legendId}>
        {salesWorldCountries.map(country => {
          const code = country.iso2;
          if (!code) return <path key={country.id} d={country.path} fill={neutral}
            fillRule="evenodd" className="sales-map-country" aria-hidden="true" />;
          const group = byCode.get(code);
          const label = group?.label || countryNames.of(code) || code;
          return <Tooltip key={country.id} label={details(label, group)} position="top" withArrow
            events={{ hover: true, focus: true, touch: false }} openDelay={80} closeDelay={100}
            transitionProps={{ duration: 0 }}>
            <path d={country.path} fill={group ? salesMapColor(salesMapValue(group, metric), thresholds) : neutral}
              fillRule="evenodd" className="sales-map-country sales-map-country-action" role="button" tabIndex={0}
              aria-label={`${label} · ${ui.openOrders}`} data-country={code}
              onFocus={() => { if (zoom > 1) setCenter(country.center); }}
              onClick={() => onCountry(code)} onKeyDown={event => activate(event, code)} />
          </Tooltip>;
        })}
      </svg>
      <span className="sales-map-zoom">
        <ActionIcon variant="default" size="md" aria-label={ui.zoomIn} disabled={zoom >= 3}
          onClick={() => setZoom(current => Math.min(3, current + 0.5))}>+</ActionIcon>
        <ActionIcon variant="default" size="md" aria-label={ui.zoomOut} disabled={zoom <= 1}
          onClick={() => setZoom(current => Math.max(1, current - 0.5))}>−</ActionIcon>
      </span>
    </span>
    <span id={legendId} className="sales-map-legend" role="group" aria-label={ui.legend}>
      <span className="sales-map-units">{units}</span>
      {[...colors].reverse().map((color, reverseIndex) => <span className="sales-map-bin" key={color}>
        <i style={{ backgroundColor: color }} aria-hidden="true" />{rangeLabel(4 - reverseIndex)}
      </span>)}
      <span className="sales-map-bin"><i style={{ backgroundColor: neutral }} aria-hidden="true" />{valueLabel(0)}</span>
      <span className="sales-map-bin"><i style={{ backgroundColor: missing }} aria-hidden="true" />{ui.noData}</span>
    </span>
    <span className="sales-map-alternative">
      <Select size="xs" label={ui.selectCountry} placeholder={ui.country} searchable clearable value={null}
        data={known.map(group => ({ value: salesMapIso2(group.country)!, label: group.label }))}
        onChange={code => { if (code) onCountry(code); }} nothingFoundMessage={ui.noData} />
      {unknown.map(group => <Tooltip key={group.key} label={details(group.label, group)}
        events={{ hover: true, focus: true, touch: false }}>
        <Button variant="subtle" size="compact-xs" onClick={() => onCountry(group.key)}>
          {group.label} · {counts.format(group.orders)}
        </Button>
      </Tooltip>)}
    </span>
  </span>;
}
