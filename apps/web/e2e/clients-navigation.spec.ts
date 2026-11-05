import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const writes: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const conversation = { id: 'dialogue-exact', channel: 'INSTAGRAM', archivedAt: null, unreadCount: 0, lastMessageAt: '2026-11-01T12:00:00Z', messages: [] };
  const client = { id: 'canonical', displayName: 'Navigation fixture', firstName: 'Navigation', status: 'ACTIVE', source: 'INSTAGRAM', preferredChannel: 'INSTAGRAM', conversations: [conversation], linkedChannels: ['INSTAGRAM'], orders: [], athletes: [], activities: [], files: [], workTasks: [], _count: { orders: 0, athletes: 0 } };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 405, json: {} }); }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture-owner', displayName: 'QA', role: 'OWNER' } } });
    if (path === '/api/branding') return route.fulfill({ json: {} });
    if (path === '/api/clients') return route.fulfill({ json: [client] });
    if (path === '/api/clients/canonical') return route.fulfill({ json: client });
    if (path === '/api/communications') return route.fulfill({ json: { items: [client], total: 1, hasMore: false, channelCounts: { INSTAGRAM: 1 }, scopeCounts: { all: 1, unread: 0, waiting: 0 } } });
    if (path === '/api/communications/canonical') return route.fulfill({ json: { ...conversation, clientId: client.id, messages: [] } });
    if (path === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (path === '/api/orders/website-notifications') return route.fulfill({ json: { items: [], unreadCount: 0 } });
    if (path.includes('/summaries')) return route.fulfill({ json: { firstMessageDate: null, items: [] } });
    return route.fulfill({ json: [] });
  });
  return { writes, consoleErrors };
}

for (const width of [1920, 1366, 390]) {
  test(`common header has one active Clients entry at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = await fixture(page);
    await page.goto('/?section=clients&clientId=canonical');
    const nav = page.locator('.crm-topbar-nav');
    const clients = nav.getByRole('button', { name: 'Клиенты', exact: true });
    await expect(clients).toHaveCount(1);
    await expect(clients).toHaveAttribute('aria-current', 'page');
    await expect(clients.locator('svg')).toHaveCount(1);
    await expect(nav.getByRole('button')).toHaveCount(8);
    await clients.scrollIntoViewIfNeeded();
    await expect(clients).toBeInViewport();
    await page.locator('.crm-topbar').screenshot({ path: testInfo.outputPath(`clients-header-${width}.png`) });
    expect(state.writes).toEqual([]);
    expect(state.consoleErrors).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Inbox client action restores Clients filters and the exact Back conversation without sending', async ({ page }) => {
  const state = await fixture(page);
  const clientsReturn = '/?section=clients&clientId=stale&page=3&pageSize=50&search=Anna&country=UA';
  await page.goto('/?' + new URLSearchParams({ section: 'inbox', clientId: 'canonical', conversationId: 'dialogue-exact', channel: 'INSTAGRAM', clientsReturn }));
  await page.locator('.communications-open-client').click();
  await expect(page).toHaveURL(/section=clients/);
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of Object.entries({ clientId: 'canonical', returnConversationId: 'dialogue-exact', returnChannel: 'INSTAGRAM', page: '3', pageSize: '50', search: 'Anna', country: 'UA', clientName: 'Navigation fixture' })) expect(params.get(key), key).toBe(value);
  expect(params.has('clientsReturn')).toBe(false);
  await page.getByRole('button', { name: 'Вернуться к переписке' }).click();
  await expect(page.locator('.communications-search-field input')).toHaveValue('Navigation fixture');
  await expect(page).toHaveURL(/conversationId=dialogue-exact/);
  expect(state.writes.filter(path => /send|messages/.test(path))).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
});
