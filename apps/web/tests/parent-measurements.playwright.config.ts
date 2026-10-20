import { defineConfig } from '@playwright/test';

// Use the isolated webpack dev server on 3517; shared symlink dependencies cannot use Turbopack.
export default defineConfig({
  testDir: '../e2e',
  testMatch: 'parent-measurements.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.PM_WEB_ORIGIN ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3517}`, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  reporter: 'line',
});
