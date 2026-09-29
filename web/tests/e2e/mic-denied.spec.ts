import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

test.use({
  permissions: [],
  launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] },
});
test('shows a clear error and fallbacks, and creates no meeting', async ({ page }) => {
  await signUp(page);
  await page.goto('/meetings/new?mode=offline');
  await page.getByLabel('Meeting Title').fill('Denied mic test');
  await page.getByTestId('start-button').click();
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('form-error')).toContainText('Microphone access was denied');
  await expect(page.getByRole('link', { name: 'upload a recording' })).toBeVisible();
  await page.goto('/meetings');
  await expect(page.getByText('No meetings match.')).toBeVisible();
});
