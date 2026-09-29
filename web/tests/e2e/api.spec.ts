import { test, expect, request, APIRequestContext } from '@playwright/test';

/**
 * API-level failure and scale tests. Some need a second server started with special env:
 *   FAIL_URL  (default http://localhost:3001): MOCK_TRANSCRIPTION_FAIL=1 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=invalid
 *   LONG_URL  (default http://localhost:3002): FINAL_PASS_MAX_CHARS=3000 (forces windowed final pass)
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const FAIL_URL = process.env.FAIL_URL || 'http://localhost:3001';
const LONG_URL = process.env.LONG_URL || 'http://localhost:3002';
const audio = Buffer.alloc(4000, 7);

async function login(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const email = `api-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await api.post('/api/auth/register', { data: { name: 'API Tester', email, password: 'password123' } });
  expect(r.ok()).toBeTruthy();
  return api;
}
async function meeting(api: APIRequestContext, title: string, extra: Record<string, unknown> = {}) {
  const r = await api.post('/api/meetings', { data: { title, meetingType: 'Internal Meeting', mode: 'offline', consent: true, timezone: 'Asia/Kolkata', ...extra } });
  expect(r.status()).toBe(201);
  const id = (await r.json()).meeting.id as string;
  expect((await api.post(`/api/meetings/${id}/state`, { data: { action: 'start' } })).ok()).toBeTruthy();
  return id;
}
const seg = (api: APIRequestContext, id: string, seq: number, silent = false) =>
  api.post(`/api/meetings/${id}/segments`, {
    multipart: { audio: { name: 'a.webm', mimeType: 'audio/webm', buffer: audio }, seq: String(seq), startMs: String(seq * 20000), durationMs: '20000', silent: silent ? '1' : '0' },
  });
async function waitStatus(api: APIRequestContext, id: string, status: string) {
  for (let i = 0; i < 60; i++) {
    const m = (await (await api.get(`/api/meetings/${id}`)).json()).meeting;
    if (m.status === status) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`meeting never reached ${status}`);
}

test('consent is required to create a meeting; unauthenticated access is rejected', async () => {
  const api = await login(BASE);
  const r = await api.post('/api/meetings', { data: { title: 'x', mode: 'offline', consent: false } });
  expect(r.status()).toBe(400);
  const anon = await request.newContext({ baseURL: BASE });
  expect((await anon.get('/api/meetings')).status()).toBe(401);
  expect((await anon.get('/api/meetings/00000000-0000-0000-0000-000000000000')).status()).toBe(401);
});

test("users cannot read each other's meetings", async () => {
  const a = await login(BASE);
  const b = await login(BASE);
  const id = await meeting(a, 'Private');
  expect((await b.get(`/api/meetings/${id}`)).status()).toBe(404);
  expect((await b.get(`/api/meetings/${id}/transcript`)).status()).toBe(404);
  expect((await b.delete(`/api/meetings/${id}`)).status()).toBe(404);
});

test('no speech: silent segments are skipped and final notes say so', async () => {
  const api = await login(BASE);
  const id = await meeting(api, 'Silent room');
  for (let i = 0; i < 3; i++) expect((await (await seg(api, id, i, true)).json()).skipped).toBe('silence');
  await api.post(`/api/meetings/${id}/state`, { data: { action: 'stop', durationSeconds: 60 } });
  await waitStatus(api, id, 'COMPLETED');
  const d = await (await api.get(`/api/meetings/${id}`)).json();
  expect(d.notes.summary).toBe('No speech was captured in this meeting.');
  expect(d.actions).toHaveLength(0);
});

test('duplicate segment uploads (client retries) do not duplicate the transcript', async () => {
  const api = await login(BASE);
  const id = await meeting(api, 'Retry');
  await seg(api, id, 0);
  const again = await (await seg(api, id, 0)).json();
  expect(again.duplicate).toBe(true);
  const t = await (await api.get(`/api/meetings/${id}/transcript`)).json();
  expect(t.total).toBe(1);
});

test('state machine: pause/resume/stop and invalid transitions', async () => {
  const api = await login(BASE);
  const id = await meeting(api, 'States');
  // Repeating a transition is idempotent (safe client retries).
  expect((await api.post(`/api/meetings/${id}/state`, { data: { action: 'start' } })).status()).toBe(200);
  expect((await (await api.post(`/api/meetings/${id}/state`, { data: { action: 'pause', durationSeconds: 5 } })).json()).meeting.status).toBe('PAUSED');
  expect((await (await api.post(`/api/meetings/${id}/state`, { data: { action: 'resume' } })).json()).meeting.transcription_status).toBe('TRANSCRIBING');
  await api.post(`/api/meetings/${id}/state`, { data: { action: 'stop', durationSeconds: 9 } });
  const m = await waitStatus(api, id, 'COMPLETED');
  expect(m.duration_seconds).toBe(9);
  expect((await seg(api, id, 5)).status()).toBe(409); // no audio after completion
  expect((await api.post(`/api/meetings/${id}/state`, { data: { action: 'pause' } })).status()).toBe(409);
});

test('long meeting (2 hours of 20 s segments): paginated transcript and windowed final pass', async () => {
  test.setTimeout(300_000);
  const api = await login(LONG_URL);
  const id = await meeting(api, 'Two hour planning session');
  for (let i = 0; i < 360; i++) expect((await seg(api, id, i)).ok()).toBeTruthy();
  const page1 = await (await api.get(`/api/meetings/${id}/transcript?limit=200`)).json();
  expect(page1.segments).toHaveLength(200);
  expect(page1.hasMore).toBe(true);
  expect(page1.total).toBe(360);
  const page2 = await (await api.get(`/api/meetings/${id}/transcript?limit=200&after=${page1.segments[199].seq}`)).json();
  expect(page2.segments).toHaveLength(160);
  await api.post(`/api/meetings/${id}/state`, { data: { action: 'stop', durationSeconds: 7200 } });
  await waitStatus(api, id, 'COMPLETED');
  const d = await (await api.get(`/api/meetings/${id}`)).json();
  expect(d.notes.is_final).toBe(true);
  expect(d.notes.decisions.length).toBeGreaterThan(0);
  expect(d.actions.some((a: any) => a.owner === 'Vivek' && a.deadline_text === 'by Friday')).toBe(true);
  // Duplicated script lines must not create duplicate actions.
  const tasks = d.actions.map((a: any) => a.task.toLowerCase());
  expect(new Set(tasks).size).toBe(tasks.length);
});

test.describe('provider failures', () => {
  test.skip(!!process.env.SKIP_FAIL_SERVER, 'fail server not running');

  test('transcription API failure: segment is rejected as retryable and the error is surfaced', async () => {
    const api = await login(FAIL_URL);
    const id = await meeting(api, 'Transcription down');
    const r = await seg(api, id, 0);
    expect(r.status()).toBe(503); // client queue keeps the audio and retries
    const live = await (await api.get(`/api/meetings/${id}/live`)).json();
    expect(live.meeting.error).toMatch(/Transcription error/);
    expect(live.chunks.failed).toBe(1);
  });

  test('AI API failure: meeting still completes with transcript kept and a clear error', async () => {
    const api = await login(FAIL_URL);
    const id = await meeting(api, 'AI down', { transcription: 'browser' });
    await api.post(`/api/meetings/${id}/transcript`, { data: { items: [
      { seq: 1, offsetMs: 1000, text: 'Amit, please send the school list by tomorrow.', confidence: 0.9 },
      { seq: 2, offsetMs: 5000, text: 'We decided to use the CoE channel.', confidence: 0.9 },
    ] } });
    await api.post(`/api/meetings/${id}/state`, { data: { action: 'stop', durationSeconds: 30 } });
    const m = await waitStatus(api, id, 'COMPLETED');
    expect(m.error).toMatch(/Final notes could not be generated/);
    const t = await (await api.get(`/api/meetings/${id}/transcript`)).json();
    expect(t.total).toBe(2);
    const regen = await (await api.post(`/api/meetings/${id}/notes`)).json();
    expect(regen.error).toBeTruthy();
  });
});
