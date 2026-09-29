import { test, expect } from '@playwright/test';
import { signUp, fastSegments, chooseServerTranscription } from './helpers';

test('network drop buffers audio locally and uploads it after reconnecting', async ({ page, context }) => {
  await signUp(page);
  await fastSegments(page);
  await page.goto('/meetings/new?mode=offline');
  await page.getByLabel('Meeting Title').fill('Network test');
  await chooseServerTranscription(page);
  await page.getByTestId('start-button').click();
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await expect(page.getByTestId('live-transcript')).toContainText("Let's get started", { timeout: 20000 });

  await context.setOffline(true);
  await expect(page.getByTestId('audio-status')).toHaveText('DISCONNECTED', { timeout: 20000 });
  await expect(page.getByText(/segment\(s\) buffered on this device/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('recording-indicator')).toBeVisible(); // capture continues offline
  await context.setOffline(false);
  await expect(page.getByTestId('audio-status')).toHaveText('CONNECTED', { timeout: 40000 });
  await expect(page.getByTestId('live-transcript')).toContainText('Registrations are at 120 schools', { timeout: 30000 });
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('meeting-status')).toHaveText('Completed', { timeout: 60000 });
});

test('browser refresh during recording offers recovery and can finish the meeting', async ({ page }) => {
  await signUp(page);
  await fastSegments(page);
  await page.goto('/meetings/new?mode=offline');
  await page.getByLabel('Meeting Title').fill('Refresh test');
  await chooseServerTranscription(page);
  await page.getByTestId('start-button').click();
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('live-transcript')).toContainText('240 schools', { timeout: 30000 });
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByTestId('recover-panel')).toBeVisible();
  await expect(page.getByTestId('live-transcript')).toContainText('240 schools'); // saved transcript survived
  await page.getByRole('button', { name: 'Finish & generate notes' }).click();
  await expect(page.getByTestId('meeting-status')).toHaveText('Completed', { timeout: 60000 });
  await expect(page.getByTestId('summary')).not.toBeEmpty();
});

test('demo data is present and clearly labelled for the seeded user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Password').fill('demo12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('AI Olympiad Planning Meeting').first()).toBeVisible();
  await expect(page.locator('.demo-tag').first()).toBeVisible();
  await page.goto('/actions');
  await expect(page.getByTestId('action-dashboard')).toContainText('Share updated state-wise school list');
});
