import { test, expect, chromium, request, BrowserContext, Worker } from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Loads the unpacked extension in Chromium against a stand-in Meet page (meet.google.com is routed to
 * a local page that plays a tone; the real Meet needs a Google sign-in). The popup is opened as a
 * page with chrome.tabs.query pointed at the Meet tab, because automation cannot click the toolbar.
 *
 * Chrome only grants tabCapture after a toolbar click. Test 1 runs without that grant and checks the
 * "unavailable" message and fallbacks. Test 2 uses Chromium's --allowlisted-extension-id test switch
 * to stand in for the click, and runs the full capture → upload → transcript → notes → stop flow.
 */
const EXT = path.resolve(__dirname, '../../../extension');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EXT_ID = crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const FAKE_MEET = `<html><head><title>Meet - AI Olympiad Weekly Review</title></head><body><h1>Fake Meet</h1>
<script>
  // Stand-in for remote participants' audio: a tone with 1 s on / 0.5 s off.
  const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.value = 440; o.connect(g); g.connect(ctx.destination); o.start();
  setInterval(() => { g.gain.value = g.gain.value ? 0 : 0.3; }, 750); ctx.resume();
</script></body></html>`;

async function setup(allowlist: boolean) {
  const api = await request.newContext({ baseURL: BASE });
  await api.post('/api/auth/register', { data: { name: 'Ext Tester', email: `ext-${Date.now()}-${Math.random()}@example.com`, password: 'password123' } });
  const { token } = await (await api.post('/api/tokens', { data: { name: 'e2e' } })).json();
  const ctx = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: false,
    args: [
      ...(process.env.HEADED ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required',
      ...(allowlist ? [`--allowlisted-extension-id=${EXT_ID}`] : []),
    ],
  });
  await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_MEET }));
  let sw: Worker | null = null;
  for (let i = 0; i < 50 && !sw; i++) {
    for (const w of ctx.serviceWorkers())
      if (w.url().startsWith(`chrome-extension://${EXT_ID}/`) && (await w.evaluate(() => typeof chrome !== 'undefined' && !!chrome.tabs).catch(() => false))) sw = w;
    if (!sw) await new Promise((r) => setTimeout(r, 200));
  }
  if (!sw) throw new Error('extension service worker not found');
  return { ctx, sw, token };
}

async function connect(ctx: BrowserContext, token: string) {
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${EXT_ID}/options.html`);
  await opts.fill('#server', BASE);
  await opts.fill('#token', token);
  await opts.click('#save');
  await expect(opts.locator('#msg')).toContainText('Connected as Ext Tester');
}

async function openMeetAndPopup(ctx: BrowserContext, sw: Worker) {
  const other = await ctx.newPage();
  await other.goto(`${BASE}/privacy`);
  const meet = await ctx.newPage();
  await meet.goto('https://meet.google.com/abc-defg-hij');
  // Without the "tabs" permission URLs are hidden from the extension, so identify tabs by creation order.
  const ids: number[] = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!).sort((a, b) => a - b));
  const meetTabId = ids[ids.length - 1];
  const otherTabId = ids[ids.length - 2];
  const popup = await ctx.newPage();
  await popup.addInitScript((tabId) => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    (chrome.tabs as any).query = async (q: any) => (q.active ? [await chrome.tabs.get(tabId)] : orig(q));
  }, meetTabId);
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  return { meet, popup, meetTabId, otherTabId };
}

test('extension: minimal permissions, Meet detection, consent, and fallback when capture is refused', async () => {
  const { ctx, sw, token } = await setup(false);
  const manifest: any = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions.sort()).toEqual(['activeTab', 'offscreen', 'storage', 'tabCapture']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts[0].matches).toEqual(['https://meet.google.com/*']);
  await connect(ctx, token);
  const { popup, meetTabId, otherTabId, meet } = await openMeetAndPopup(ctx, sw);

  expect(await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'meet-info' }), meetTabId)).toEqual({ code: 'abc-defg-hij', title: 'AI Olympiad Weekly Review' });
  await expect(sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'meet-info' }), otherTabId)).rejects.toThrow(); // no content script elsewhere

  await expect(popup.locator('#v-ready .ok')).toHaveText('Google Meet detected');
  await expect(popup.locator('#title')).toHaveValue('AI Olympiad Weekly Review');
  await expect(popup.getByText('Status: Not Recording')).toBeVisible();
  await popup.click('#start');
  await expect(popup.getByText('This meeting will be recorded/transcribed to generate meeting notes.')).toBeVisible();
  await popup.click('#consent-ok');
  await expect(popup.locator('#err-text')).toContainText('Meet audio capture is unavailable in this browser configuration.');
  await expect(popup.locator('#v-error').getByText('Use Microphone Mode')).toBeVisible();
  await expect(popup.locator('#v-error').getByText('Upload Meeting Recording')).toBeVisible();
  await expect(meet.locator('#meeting-ai-badge')).toHaveCount(0); // nothing is recording
  await ctx.close();
});

test('extension: captures Meet tab audio → live transcript → notes → pause/resume → stop → final notes', async () => {
  const { ctx, sw, token } = await setup(true);
  await connect(ctx, token);
  await sw.evaluate(() => chrome.storage.local.set({ debugSegmentMs: 3000 }));
  const { popup, meet } = await openMeetAndPopup(ctx, sw);
  await expect(popup.locator('#v-ready')).toBeVisible();
  await popup.fill('#people', 'Amit, Vivek, Praveen');
  await popup.click('#start');
  await popup.click('#consent-ok');

  await expect(popup.locator('#rec-label')).toHaveText('● Recording', { timeout: 20000 });
  await expect(meet.locator('#meeting-ai-badge')).toHaveText('● Recording — Meeting AI is taking notes');
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('REC');
  await expect(popup.locator('#timer')).not.toHaveText('00:00:00');
  await expect(popup.locator('#lines')).toContainText('240 schools', { timeout: 30000 });
  await expect(popup.locator('#audio-status')).toHaveText(/CONNECTED|BUFFERING/);
  await expect(popup.locator('#n-status')).toContainText('Updated', { timeout: 30000 });

  await popup.click('#pause');
  await expect(popup.locator('#rec-label')).toHaveText('Paused');
  await expect(meet.locator('#meeting-ai-badge')).toContainText('paused');
  await popup.click('#resume');
  await expect(popup.locator('#rec-label')).toHaveText('● Recording');
  await expect(popup.locator('#lines')).toContainText('Vivek, please follow up', { timeout: 40000 });

  const meetingId: string = await sw.evaluate(async () => (await chrome.storage.session.get('rec')).rec.meetingId);
  await popup.click('#stop');
  await expect(popup.getByText('Meeting stopped.')).toBeVisible({ timeout: 60000 });
  await expect(meet.locator('#meeting-ai-badge')).toHaveCount(0);

  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  let d: any;
  for (let i = 0; i < 40; i++) {
    d = await (await api.get(`/api/meetings/${meetingId}`)).json();
    if (d.meeting.status === 'COMPLETED') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(d.meeting.status).toBe('COMPLETED');
  expect(d.meeting.mode).toBe('meet');
  expect(d.meeting.meet_code).toBe('abc-defg-hij');
  expect(d.participants.map((p: any) => p.name).sort()).toEqual(['Amit', 'Praveen', 'Vivek']);
  expect(d.notes.is_final).toBe(true);
  expect(d.actions.some((a: any) => a.owner === 'Vivek' && a.deadline_text === 'by Friday')).toBe(true);
  expect(d.audio.stored).toBeGreaterThan(3);
  await ctx.close();
});

test('extension: closing the Meet tab while recording finishes the meeting with what was captured', async () => {
  const { ctx, sw, token } = await setup(true);
  await connect(ctx, token);
  await sw.evaluate(() => chrome.storage.local.set({ debugSegmentMs: 3000 }));
  const { popup, meet } = await openMeetAndPopup(ctx, sw);
  await popup.click('#start');
  await popup.click('#consent-ok');
  await expect(popup.locator('#lines')).toContainText("Let's get started", { timeout: 30000 });
  const meetingId: string = await sw.evaluate(async () => (await chrome.storage.session.get('rec')).rec.meetingId);
  await meet.close();
  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  let m: any;
  for (let i = 0; i < 80; i++) {
    m = (await (await api.get(`/api/meetings/${meetingId}`)).json()).meeting;
    if (m.status === 'COMPLETED') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(m.status).toBe('COMPLETED');
  const rec = await sw.evaluate(async () => (await chrome.storage.session.get('rec')).rec);
  expect(rec.status).toBe('finished');
  expect(rec.note).toMatch(/closed|ended/);
  await ctx.close();
});
