// End to end tests of the Content studio shell, run inside the real LogiShell frame served by the skill's preview.
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './specs',
  // Outside the shell folder: the preview reloads the tools whenever a file in that folder changes.
  outputDir: join(tmpdir(), 'content-studio-e2e'),
  globalSetup: './preview.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
