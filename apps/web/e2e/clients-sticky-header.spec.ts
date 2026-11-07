import { expect, test } from '@playwright/test';
import { fixture, rows } from '../components/clients/tests/fixtures';

for (const width of [1920, 1366, 390]) {
  test(`client headings follow filters without a reserved right gutter at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await fixture(page);
    const clients = Array.from({ length: 60 }, (_, index) => ({
      ...rows[index % rows.length]!, id: `sticky-${index}`, displayName: `Client ${index + 1}`,
    }));
    await page.route('**/api/clients?**', route => {
      const url = new URL(route.request().url());
      if (url.pathname !== '/api/clients') return route.fallback();
      const pageNumber = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: {
        items: clients.slice((pageNumber - 1) * 20, pageNumber * 20), total: 60,
        page: pageNumber, pageSize: 20,
        statistics: { active: 40, leads: 20, repeat: 20 },
        filters: { sources: ['INSTAGRAM'], countries: ['Spain'], statuses: ['ACTIVE'] },
      } });
    });
    await page.goto('/?section=clients');
    await expect(page.locator('.clients-table tbody tr')).toHaveCount(20);
    await page.locator('.crm-content').evaluate(element => { element.scrollTop = 550; });

    const headerGap = () => page.locator('.clients-table thead').evaluate(element => {
      const controls = document.querySelector('.clients-sticky-controls')!;
      return Math.abs(element.getBoundingClientRect().top - controls.getBoundingClientRect().bottom);
    });
    await expect.poll(headerGap).toBeLessThan(2);
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Период создания', exact: true })).toBeVisible();
    await expect.poll(headerGap).toBeLessThan(2);

    const viewport = page.locator('.clients-table-panel .mantine-ScrollArea-viewport');
    expect(await viewport.evaluate(element => getComputedStyle(element).paddingRight)).toBe('0px');
    await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await page.locator('.clients-table').evaluate(table =>
      Array.from((table as HTMLTableElement).tHead!.rows[0]!.cells).every((heading, index) =>
        Math.abs(heading.getBoundingClientRect().left - (table as HTMLTableElement).tBodies[0]!.rows[0]!.cells[index]!.getBoundingClientRect().left) < 1),
    )).toBe(true);
    await page.getByRole('button', { name: /Дата создания/ }).click();
    await expect(page).toHaveURL(/direction=asc/);
    await expect(page.locator('.clients-table tbody tr')).toHaveCount(20);
    await page.locator('.crm-content').evaluate(element => { element.scrollTop = 550; });
    await expect.poll(headerGap).toBeLessThan(2);
    expect(calls.filter(call => call.method !== 'GET')).toEqual([]);
    await page.screenshot({ path: `../../output/playwright/header-copy-cleanup/clients-sticky-${width}.png` });
  });
}
