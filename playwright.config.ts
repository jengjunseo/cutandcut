import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  use: {
    baseURL: process.env.TEST_URL ?? 'http://localhost:5174',
    browserName: 'chromium',
    channel: process.env.TEST_CHANNEL ?? 'chrome',
    headless: true,
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
    actionTimeout: 15000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
});
