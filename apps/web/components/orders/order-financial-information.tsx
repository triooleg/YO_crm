'use client';
import { Alert, Group, Paper, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core';
import { CrmNavIcon } from '../crm-nav-icon';
import { taxIntegrationOrderUi as ui } from '../../lib/i18n';
import { taxAmount } from '../../lib/tax-accounting';
import { orderTaxPresentation, type OrderPriceEstimate } from '../../lib/order-tax-presentation';

type Order = Parameters<typeof orderTaxPresentation>[0];
export function OrderFinancialInformation({ order, items, estimate }: { order: Order; items: Parameters<typeof orderTaxPresentation>[1]; estimate?: OrderPriceEstimate | null }) {
  const view = orderTaxPresentation(order, items, estimate);
  const cards = [
    { title: ui.costumes, value: view.allocated ? taxAmount(view.productsMinor, order.currency) : ui.notAllocated, hint: `${ui.lineAmounts}: ${taxAmount(view.productsMinor, order.currency)}` },
    { title: ui.clientDelivery, value: view.allocated ? taxAmount(view.deliveryMinor, order.currency) : ui.notAllocated, hint: ui.storedDelivery },
    { title: ui.includedTax, value: view.priceTaxMinor === null ? ui.notCalculated : taxAmount(view.priceTaxMinor, order.currency), hint: estimate ? `${ui.priceEstimate} · ${estimate.asOfDate}` : ui.priceEstimate },
    { title: ui.fullPrice, value: taxAmount(view.totalMinor, order.currency), hint: ui.fixedPriceHint },
  ];
  return <Paper withBorder p="md" radius="md" className="tax-order-information">
    <Stack gap="md"><div><Title order={3}>{ui.financialInformation}</Title><Text size="sm" c="dimmed">{ui.financialSubtitle}</Text></div>
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="sm">{cards.map((card, index) => <Paper withBorder p="md" radius="md" className={`tax-order-price-card${index === 3 ? ' tax-order-price-total' : ''}`} key={card.title}>
        <Group wrap="nowrap" align="flex-start" gap="md"><ThemeIcon size={50} radius="xl" variant="light" color={index===1?'blue':index===2?'pink':'yoleotard'} aria-hidden="true">{index===2?<Text size="xl">%</Text>:<CrmNavIcon section={index===0?'orders':index===1?'shipping':'finance'}/>}</ThemeIcon><Stack gap="xs" style={{minWidth:0}}><Text className="tax-order-price-label" size="sm" fw={600}>{card.title}</Text><Text component="div" className="tax-order-price-value" fw={700}>{card.value}</Text><Text size="xs" c="dimmed">{card.hint}</Text></Stack></Group>
      </Paper>)}</SimpleGrid>
      {!view.allocated && <Alert color="violet" variant="light">{ui.allocationHint}</Alert>}
    </Stack>
  </Paper>;
}

export function OrderCostComposition({order,items,estimate}:{order:Order;items:Parameters<typeof orderTaxPresentation>[1];estimate?:OrderPriceEstimate|null}) {
  const view=orderTaxPresentation(order,items,estimate);
  return <Paper withBorder p="md" radius="md" className="tax-order-composition"><Title order={4}>{ui.breakdown}</Title><div className="tax-order-composition-grid"><Table.ScrollContainer minWidth={400} type="native"><Table><Table.Thead><Table.Tr><Table.Th>{ui.component}</Table.Th><Table.Th>{ui.amount}</Table.Th><Table.Th>{ui.description}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
    <Table.Tr><Table.Td>{ui.costumes}</Table.Td><Table.Td>{view.allocated?taxAmount(view.productsMinor,order.currency):ui.notAllocated}</Table.Td><Table.Td>{ui.lineAmounts}: {taxAmount(view.productsMinor,order.currency)}</Table.Td></Table.Tr>
    <Table.Tr><Table.Td>{ui.clientDelivery}</Table.Td><Table.Td>{view.allocated?taxAmount(view.deliveryMinor,order.currency):ui.notAllocated}</Table.Td><Table.Td>{ui.storedDelivery}</Table.Td></Table.Tr>
    <Table.Tr><Table.Td>{ui.includedTax}</Table.Td><Table.Td>{view.priceTaxMinor===null?ui.notCalculated:taxAmount(view.priceTaxMinor,order.currency)}</Table.Td><Table.Td>{ui.priceEstimate}</Table.Td></Table.Tr>
    <Table.Tr className="tax-order-composition-total"><Table.Td>{ui.fullPrice}</Table.Td><Table.Td>{taxAmount(view.totalMinor,order.currency)}</Table.Td><Table.Td>{ui.fixedPriceHint}</Table.Td></Table.Tr>
  </Table.Tbody></Table></Table.ScrollContainer><Alert color="violet" variant="light">{ui.fixedPriceHint}{!view.allocated&&<Text size="sm" mt="sm">{ui.allocationHint}</Text>}</Alert></div></Paper>;
}
