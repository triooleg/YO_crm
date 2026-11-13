import { expect, test } from '@playwright/test';

// Integration prerequisite: parent Overview uses financeRequest for summary reads.
// Run against the integrated checkout with PLAYWRIGHT_PORT=3512. All API traffic,
// users and credentials below are synthetic; no real login or backend is used.
test('actual shell logout and same-role login isolate a pending financial summary', async ({ page }) => {
  test.setTimeout(60_000);
  const sessionA = { id: 'fixture-finance-session-a', role: 'ACCOUNTANT', displayName: 'Synthetic accountant A', email: 'finance-a@example.test' };
  const sessionB = { id: 'fixture-finance-session-b', role: 'ACCOUNTANT', displayName: 'Synthetic accountant B', email: 'finance-b@example.test' };
  const password = 'synthetic-browser-fixture-only';
  let user: typeof sessionA | null = sessionA;
  let logoutCalls = 0, loginCalls = 0;
  const reads: { session: 'A' | 'B'; query: string; projection: string | null }[] = [];
  const unexpectedWrites: string[] = [], errors: string[] = [];
  let releaseA!: () => void;
  const pendingA = new Promise<void>(resolve => { releaseA = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  // Observe every DOM update, not just the final screenshot: a brief flash of A
  // after resolving its stale response must also fail this regression.
  await page.addInitScript(() => {
    const state = { oldAmountSeen: false, documentToken: crypto.randomUUID() };
    (window as unknown as { financeSessionBoundary: typeof state }).financeSessionBoundary = state;
    new MutationObserver(() => {
      const text = (document.body?.innerText || '').replace(/\s/g, '');
      if (text.includes('987654,00')) state.oldAmountSeen = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  function summary(params: URLSearchParams, owner: 'A' | 'B') {
    // Distinct whole-minor-unit values make accidental cross-session display visible.
    const current = { receivedMinor: owner === 'A' ? 98_765_400 : 222_200, expensesMinor: 0, resultMinor: owner === 'A' ? 98_765_400 : 222_200 };
    const month = params.get('month') || '2026-11';
    return {
      projection: 'summary', month, currency: 'EUR', valuationVersion: `fixture-${owner}`,
      valuation: { provider: 'NBU', effectiveDate: '2026-11-02', fetchedAt: '2026-11-02T12:00:00Z', officialUrl: null },
      today: '2026-11-02', forecastUntil: '2026-12-02', current,
      previous: { receivedMinor: 0, expensesMinor: 0, resultMinor: 0 },
      debtMinor: 0, forecastMinor: 0, forecastCount: 0,
      invoiceCount: 0, invoiceTotalMinor: 0, unpaidInvoiceCount: 0,
      monthlyTrend: [{ month, ...current }], categoryBreakdown: [], recentExpenses: [], upcoming: [],
      table: { tab: 'payments', rows: [], total: 0, page: 1, pageSize: 10 },
      options: { clients: [], categories: [], orders: [] },
    };
  }

  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname === '/api/auth/me') {
      return user ? route.fulfill({ json: { user } }) : route.fulfill({ status: 401, json: { message: 'Synthetic session ended' } });
    }
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      logoutCalls++; user = null;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON();
      if (credentials.email !== sessionB.email || credentials.password !== password) {
        return route.fulfill({ status: 403, json: { message: 'Only synthetic fixture B may log in' } });
      }
      loginCalls++; user = sessionB;
      return route.fulfill({ json: { user } });
    }
    if (url.pathname === '/api/finance/report' && method === 'GET') {
      if (!user) return route.fulfill({ status: 401, json: { message: 'Synthetic session required' } });
      const owner = user.id === sessionA.id ? 'A' : 'B';
      const params = new URLSearchParams(url.searchParams); params.sort();
      reads.push({ session: owner, query: params.toString(), projection: params.get('projection') });
      if (owner === 'A') await pendingA;
      return route.fulfill({ headers: { 'x-fixture-session': owner }, json: summary(params, owner) });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      unexpectedWrites.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { message: 'No other fixture mutations allowed' } });
    }
    if (url.pathname === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (url.pathname === '/api/orders/website-notifications') return route.fulfill({ json: { unreadCount: 0, items: [] } });
    if (url.pathname === '/api/finance/report/options') return route.fulfill({ json: { orders: [], clients: [] } });
    return route.fulfill({ json: {} });
  });

  try {
    await page.goto('/?section=overview&period=2026-11&currency=EUR');
    await expect(page.locator('.crm-topbar-user')).toContainText(sessionA.displayName);
    await expect.poll(() => reads.length).toBe(1);
    expect(reads[0].projection, 'requires integrated Overview summary projection').toBe('summary');
    const documentToken = await page.evaluate(() => (window as unknown as { financeSessionBoundary: { documentToken: string } }).financeSessionBoundary.documentToken);
    const received = page.locator('.overview-kpi').filter({ has: page.getByRole('heading', { name: 'Получено', exact: true }) });
    await expect(received.getByRole('status')).toBeVisible();

    // Real shell profile menu, logout handler, login form and login callback.
    // No reload, page.evaluate login, injected React state or auth-event shortcut.
    await page.getByRole('button', { name: 'Меню профиля', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Вход в Yoleotard CRM', exact: true })).toBeVisible();
    expect(logoutCalls).toBe(1);
    await page.getByLabel('Логин (e-mail)', { exact: true }).fill(sessionB.email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.locator('.crm-topbar-user')).toContainText(sessionB.displayName);
    await expect.poll(() => reads.length, { message: 'same-role B must start a second transport while A is still pending' }).toBe(2);
    expect(loginCalls).toBe(1);
    expect(reads.map(read => read.session)).toEqual(['A', 'B']);
    expect(reads[1].query, 'same role and same query must not reuse the previous session flight').toBe(reads[0].query);
    await expect(received.locator('strong')).toContainText(/2\s*222,00/);

    // B is visible before A is released. Require A to really finish at the
    // transport boundary, then check both lasting and transient DOM exposure.
    const oldResponse = page.waitForResponse(response => response.headers()['x-fixture-session'] === 'A');
    releaseA();
    expect(await (await oldResponse).finished(), 'old A transport must finish, not merely abort').toBeNull();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(received.locator('strong')).toContainText(/2\s*222,00/);
    expect(reads).toHaveLength(2);
    const evidence = await page.evaluate(() => (window as unknown as { financeSessionBoundary: { oldAmountSeen: boolean; documentToken: string } }).financeSessionBoundary);
    expect(evidence.documentToken, 'session transition must preserve the actual shell document').toBe(documentToken);
    expect(evidence.oldAmountSeen, 'stale A must never flash in the DOM').toBe(false);
    expect(unexpectedWrites).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    releaseA(); // Do not leave a routed request pending when an assertion fails.
  }
});
