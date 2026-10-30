"use client";
import { useEffect, useState } from 'react';
import { Loader, SegmentedControl } from '@mantine/core';
import { OverviewWorkspace } from './overview-workspace';
import { SalesStatisticsWorkspace } from './sales-statistics-workspace';
import { salesStatisticsUi as ui } from '../lib/i18n';
import type { OverviewNavigate } from '../lib/overview-report';

/** Keeps the established operational workspace and its domain requests intact. */
export function OverviewModesWorkspace({ role, onNavigate }: { role: string; onNavigate: OverviewNavigate }) {
  const [view, setView] = useState<'overview' | 'statistics' | null>(null);
  const allowed = ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(role);
  useEffect(() => {
    const read = () => setView(allowed && new URLSearchParams(window.location.search).get('view') === 'statistics' ? 'statistics' : 'overview');
    read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read);
  }, [allowed]);
  function change(next: 'overview' | 'statistics') {
    const params = new URLSearchParams(window.location.search), context: Record<string, string> = {};
    for (const [key, value] of params) if (key !== 'section') context[key] = value;
    context.view = next;
    if (next === 'overview' && context.to) context.period = context.to.slice(0, 7);
    if (next === 'statistics' && context.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(context.period) && (!context.to || context.to.slice(0, 7) !== context.period)) {
      context.from = context.period + '-01';
      const end = new Date(`${context.from}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
      context.to = end.toISOString().slice(0, 10);
    }
    // Both views belong to the mounted overview section. Shell navigation
    // changes its route key and discards the workspace and browser scroll.
    const url = new URL(window.location.href);
    url.searchParams.set('section', 'overview');
    for (const [key, value] of Object.entries(context)) url.searchParams.set(key, value);
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setView(next);
  }
  if (view === null) return <div role="status" aria-label={ui.loading}><Loader size="sm" /></div>;
  if (view === 'statistics') return <SalesStatisticsWorkspace role={role} onNavigate={onNavigate} onModeChange={change} />;
  return <OverviewWorkspace role={role} onNavigate={onNavigate} modeControl={allowed ? <SegmentedControl className="overview-mode-control sales-statistics-mode" aria-label={ui.modeLabel} value="overview" onChange={value => change(value as 'overview' | 'statistics')} data={[{ value: 'overview', label: ui.overview }, { value: 'statistics', label: ui.statistics }]} /> : undefined} />;
}
