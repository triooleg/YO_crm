'use client';
import { Accordion, Alert, Anchor, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { TaxOrderEstimate } from '../../lib/tax-integration-contract';
import { taxAccountingUi as ui, taxIntegrationOrderUi as integrationUi } from '../../lib/i18n';
import { canReadTaxes, taxAmount } from '../../lib/tax-accounting';
import { TaxEntries, TaxLoading, TaxSection, taxApi, useTaxPendingRefresh, useTaxResource } from './shared';
type Props = { orderId: string; role: string; refreshKey?: string | number; renderFinance?: (estimate: TaxOrderEstimate | undefined) => ReactNode };
export function TaxOrderPanel({ orderId, role, refreshKey, renderFinance }: Props) {
  if (!canReadTaxes(role)) return <>{renderFinance?.(undefined)}</>;
  return <OrderContent key={`${role}:${orderId}`} orderId={orderId} refreshKey={refreshKey} renderFinance={renderFinance} />;
}
function OrderContent({ orderId, refreshKey, renderFinance }: Omit<Props, 'role'>) {
  const resource = useTaxResource(signal => taxApi.order(orderId, signal), orderId, refreshKey);
  useTaxPendingRefresh(resource.data?.incomplete === true, resource.refresh, orderId, resource.loading);
  return <Stack gap="md">{renderFinance?.(resource.error || resource.loading ? undefined : resource.data?.estimate)}
    <Accordion variant="separated"><Accordion.Item value="accruals"><Accordion.Control>{integrationUi.actualAccruals}</Accordion.Control><Accordion.Panel>
      <TaxSection title={ui.orderTitle}><Text size="sm" c="dimmed">{integrationUi.actualAccrualsHint}</Text><TaxLoading {...resource} />
        {resource.data && <>{(resource.data.incomplete || resource.data.completeness?.incomplete) && <Alert color="yellow">{ui.incomplete}</Alert>}<Text size="sm">{ui.accrued}: <strong>{resource.data.completeness?.incomplete || resource.data.completeness?.accruedUahMinor == null ? integrationUi.notCalculated : taxAmount(resource.data.completeness?.accruedUahMinor)}</strong></Text><TaxEntries entries={resource.data.entries} /><Text size="xs" c="dimmed">{ui.cashHint}</Text></>}
        <Anchor size="sm" href="/?section=settings&tab=taxes">{integrationUi.settingsLink}</Anchor>
      </TaxSection>
    </Accordion.Panel></Accordion.Item></Accordion>
  </Stack>;
}
