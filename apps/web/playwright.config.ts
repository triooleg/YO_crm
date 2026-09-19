import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3500);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
