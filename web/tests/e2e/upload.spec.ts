import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

function sineWav(seconds: number, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

test('upload recording fallback: file is chunked, transcribed and summarised', async ({ page }) => {
  await signUp(page);
  await page.goto('/meetings/new?mode=upload');
  await page.getByLabel('Meeting Title').fill('Uploaded Meet recording');
  await page.getByLabel('Recording file').setInputFiles({ name: 'meet.wav', mimeType: 'audio/wav', buffer: sineWav(150) });
  await page.getByTestId('start-button').click();
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('meeting-status')).toHaveText('Completed', { timeout: 60000 });
  await page.getByTestId('tab-transcript').click();
  await expect(page.getByTestId('transcript')).toContainText('240 schools'); // 3 × 60 s chunks
  await page.getByTestId('tab-audio').click();
  await expect(page.getByText('3 segment(s)')).toBeVisible();
});
