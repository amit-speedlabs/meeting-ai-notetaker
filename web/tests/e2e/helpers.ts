import { Page, expect } from '@playwright/test';

export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/login');
  await page.getByText('Create one').click();
  await page.getByLabel('Name').fill('Amit Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening), Amit/)).toBeVisible();
  return email;
}

export async function fastSegments(page: Page, ms = 3000) {
  await page.evaluate((v) => {
    localStorage.setItem('mt_segment_ms', String(v));
    // Chromium's fake microphone beeps intermittently and noise suppression mutes it for seconds at
    // a time, so short test segments can be genuinely silent. Disable skipping for determinism.
    localStorage.setItem('mt_silence_threshold', '0');
  }, ms);
}

/** Waits for the form to hydrate (it defaults to browser speech when the server is in demo mode), then picks server transcription. */
export async function chooseServerTranscription(page: Page) {
  await expect(page.getByLabel(/Browser speech recognition/)).toBeChecked();
  await page.getByLabel(/Server: Demo transcription/).check();
  await expect(page.getByLabel(/Server: Demo transcription/)).toBeChecked();
}
