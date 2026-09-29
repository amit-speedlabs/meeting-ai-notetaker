import { test, expect } from '@playwright/test';
import { signUp, fastSegments, chooseServerTranscription } from './helpers';

test('offline meeting: consent → mic → live transcript → notes → stop → final notes → search → export', async ({ page }) => {
  await signUp(page);
  await fastSegments(page);
  await expect(page.getByTestId('provider-banner')).toContainText('Demo transcription is active');

  await page.getByTestId('start-offline').click();
  await page.getByLabel('Meeting Title').fill('AI Olympiad Weekly Review');
  await page.getByLabel('Meeting Type').selectOption('School Meeting');
  await page.getByRole('button', { name: '+ Add participant' }).click();
  await page.getByLabel('Participant 1 name').fill('Vivek');
  // Use server (demo) transcription so the pipeline is exercised end to end.
  await chooseServerTranscription(page);
  await page.getByTestId('start-button').click();

  // Consent is mandatory and shown before any capture.
  await expect(page.getByText('This meeting will be recorded/transcribed to generate meeting notes.')).toBeVisible();
  await page.getByTestId('consent-accept').click();

  await expect(page).toHaveURL(/\/record/);
  await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await expect(page.getByTestId('timer')).not.toHaveText('00:00:00', { timeout: 5000 });

  // Live transcript and live notes arrive while recording.
  await expect(page.getByTestId('live-transcript')).toContainText('240 schools', { timeout: 30000 });
  await expect(page.getByTestId('audio-status')).toHaveText(/CONNECTED|BUFFERING/);
  await expect(page.getByTestId('live-decisions')).toContainText('Prioritise schools', { timeout: 40000 });

  // Pause / resume.
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('paused-indicator')).toBeVisible();
  const t1 = await page.getByTestId('timer').textContent();
  await page.waitForTimeout(2500);
  expect(await page.getByTestId('timer').textContent()).toBe(t1);
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('recording-indicator')).toBeVisible();

  // Let a few more segments through so owner + deadline actions appear.
  await expect(page.getByTestId('live-transcript')).toContainText('Vivek, please follow up', { timeout: 40000 });
  await page.getByTestId('stop').click();

  // Final notes → meeting page.
  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]+$/, { timeout: 60000 });
  await expect(page.getByTestId('meeting-status')).toHaveText('Completed', { timeout: 30000 });
  await expect(page.getByTestId('summary')).toContainText('AI Olympiad Weekly Review');
  const actions = page.getByTestId('overview-actions');
  await expect(actions).toContainText('Follow up with the pending Maharashtra schools');
  await expect(actions).toContainText('Vivek');
  await expect(actions).toContainText('(by Friday)');
  await expect(actions).toContainText('Speaker 3'); // "I will share..." → the speaker label, never an invented name

  // Tabs.
  await page.getByTestId('tab-transcript').click();
  await expect(page.getByTestId('transcript')).toContainText('Speaker 1');
  await page.getByRole('button', { name: 'Rename speakers' }).click();
  await page.getByLabel('Name for Speaker 3').fill('Praveen');
  await page.getByRole('button', { name: 'Save names' }).click();
  await expect(page.getByTestId('transcript')).toContainText('Praveen:');
  await page.getByTestId('transcript-search').fill('registration');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('transcript-results')).toContainText(/registration/i);

  await page.getByTestId('tab-actions').click();
  await expect(page.getByTestId('actions-table')).toContainText('Praveen'); // owner followed the rename
  await page.getByTestId('actions-table').getByRole('button', { name: 'Complete' }).first().click();
  await expect(page.getByTestId('actions-table').locator('select').first()).toHaveValue('completed');
  await page.getByPlaceholder('New action').fill('Book the auditorium');
  await page.getByPlaceholder('Deadline e.g. Friday').fill('tomorrow');
  await page.getByRole('button', { name: 'Add action' }).click();
  await expect(page.getByTestId('actions-table')).toContainText('Book the auditorium');

  await page.getByTestId('tab-decisions').click();
  await expect(page.getByTestId('decisions')).toContainText('CoE channel');
  await page.getByTestId('tab-activity').click();
  await expect(page.getByText('speakers renamed')).toBeVisible();

  // Audio playback exists, then delete audio but keep transcript.
  await page.getByTestId('tab-audio').click();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('delete-audio').click();
  await expect(page.getByTestId('no-audio')).toBeVisible();
  await page.getByTestId('tab-transcript').click();
  await expect(page.getByTestId('transcript')).toContainText('240 schools');

  // Exports.
  await page.getByText('Export ▾').click();
  for (const f of ['pdf', 'docx', 'md', 'txt']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`export-${f}`).click()]);
    expect(dl.suggestedFilename()).toBe(`AI-Olympiad-Weekly-Review.${f}`);
  }

  // Global search.
  await page.goto('/search?q=pending%20kits');
  await page.goto('/search?q=Vivek');
  await expect(page.getByTestId('search-transcript')).toContainText('AI Olympiad Weekly Review');
  await page.getByTestId('search-transcript').getByRole('link').first().click();
  await expect(page.locator('.seg.hit')).toBeVisible();

  // Library filter.
  await page.goto('/meetings?type=School+Meeting&sort=longest');
  await expect(page.getByTestId('library-table')).toContainText('AI Olympiad Weekly Review');
  await page.goto('/meetings?type=Interview');
  await expect(page.getByText('No meetings match.')).toBeVisible();
});
