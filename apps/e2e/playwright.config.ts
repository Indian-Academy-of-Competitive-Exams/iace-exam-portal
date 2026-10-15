import { defineConfig, devices } from '@playwright/test';
import { API_ENV, API_URL, EXAMS_DIST, EXAMS_URL } from './e2e-env';

const PRISMA = '../../node_modules/.bin/prisma';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 90_000,
  use: {
    baseURL: EXAMS_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      command: `${PRISMA} migrate deploy --schema ../../prisma/schema.prisma && node --import tsx seed.ts && node ../api/dist/main.js`,
      url: `${API_URL}/health`,
      env: { ...API_ENV, TSX_TSCONFIG_PATH: '../api/test/tsconfig.json' },
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'exams',
      command: `pnpm --dir ../exams exec vite build --outDir ${EXAMS_DIST} --emptyOutDir && pnpm --dir ../exams exec vite preview --outDir ${EXAMS_DIST} --port ${new URL(EXAMS_URL).port} --strictPort`,
      url: EXAMS_URL,
      env: { VITE_API_URL: API_URL },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
