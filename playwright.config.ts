import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : undefined,
  reporter: process.env.CI
    ? process.env.SHARDED
      ? [['blob'], ['github']]
      : [['github'], ['html', { open: 'never' }]]
    : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  projects: [
    {
      name: 'api',
      testMatch: '**/api/**/*.spec.ts',
      timeout: 10_000,
    },
    {
      name: 'ledger',
      testMatch: '**/ledger/**/*.spec.ts',
      timeout: 10_000,
    },
    {
      // 'integration' project removed — no tests exist in tests/integration/
      // Max retry schedule: 1 s + 3 s + 5 s = 9 s; test.slow() triples this value.
      name: 'resilience',
      testMatch: ['**/resilience/**/*.spec.ts', '**/webhook/**/*.spec.ts'],
      timeout: 25_000,
    },
    {
      name: 'concurrency',
      testMatch: '**/concurrency/**/*.spec.ts',
      timeout: 15_000,
    },
  ],
});
