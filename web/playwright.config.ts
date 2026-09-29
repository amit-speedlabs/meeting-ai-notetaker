import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // Fake microphone (a test tone) and auto-accept of the permission prompt.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
    permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
});
