import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({testDir:'../../../e2e',testMatch:'clients-workspace.spec.ts',workers:1,reporter:'line',timeout:60000,use:{baseURL:'http://127.0.0.1:3521',reducedMotion:'reduce',trace:'retain-on-failure'},outputDir:'../../../../../.local/clients-ui-playwright',webServer:{command:'node node_modules/next/dist/bin/next dev --webpack -H 127.0.0.1 -p 3521',cwd:path.resolve(__dirname,'../../..'),url:'http://127.0.0.1:3521',reuseExistingServer:true,timeout:120000}});
