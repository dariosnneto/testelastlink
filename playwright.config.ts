import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

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
      name: 'integration',
      testMatch: '**/integration/**/*.spec.ts',
      timeout: 20_000,
    },
    {
      name: 'resilience',
      testMatch: ['**/resilience/**/*.spec.ts', '**/webhook/**/*.spec.ts'],
      timeout: 60_000,
    },
    {
      name: 'concurrency',
      testMatch: '**/concurrency/**/*.spec.ts',
      timeout: 30_000,
    },
  ],
});
