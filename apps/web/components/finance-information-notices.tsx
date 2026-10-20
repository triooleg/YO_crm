"use client";

import { Affix, Notification, Stack } from '@mantine/core';
import { useLocalStorage, useMounted } from '@mantine/hooks';
import { taxIntegrationFinanceUi as ui } from '../lib/i18n';

const storageKey = 'finance-information-dismissed-v1';
type Notice = 'valuation' | 'scope';
const empty: Notice[] = [];
function readDismissed(raw: string | undefined): Notice[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter((item): item is Notice => item === 'valuation' || item === 'scope') : [];
  } catch { return []; }
}

/** Browser-local reading preferences only; operational warnings remain in the report. */
export function FinanceInformationNotices({ presentation }: { presentation: string }) {
  const [dismissed, setDismissed] = useLocalStorage<Notice[]>({ key: storageKey, defaultValue: empty, deserialize: readDismissed });
  const mounted = useMounted();
  const valuation = Boolean(presentation) && !dismissed.includes('valuation');
  const scope = !dismissed.includes('scope');
  if (!mounted || (!valuation && !scope)) return null;
  const close = (notice: Notice) => setDismissed(current => current.includes(notice) ? current : [...current, notice]);
  return <Affix className="finance-information-notices" position={{ bottom: 16, right: 16 }}>
    <Stack gap="xs" role="region" aria-label={ui.information}>
      {valuation && <Notification color="blue" title={ui.valuationHelp} role="status" withBorder withCloseButton closeButtonProps={{ 'aria-label': ui.closeValuationHelp }} onClose={() => close('valuation')}>{presentation}</Notification>}
      {scope && <Notification color="violet" title={ui.scopeHelp} role="status" withBorder withCloseButton closeButtonProps={{ 'aria-label': ui.closeScopeHelp }} onClose={() => close('scope')}>{ui.globalScope} {ui.historicalBasis}</Notification>}
    </Stack>
  </Affix>;
}
