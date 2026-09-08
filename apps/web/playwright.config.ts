import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3500",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3500",
    url: "http://127.0.0.1:3500",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
