import { test, expect, request } from '@playwright/test';

/**
 * The free deployment configuration (see docs/DEPLOY-FREE.md), against a stand-in for Groq's API.
 * Needs two extra processes:
 *   node tests/fakes/openai-compatible.mjs                       (port 4010)
 *   a web server on FREE_URL (default http://localhost:3003) with
 *     TRANSCRIPTION_PROVIDER=groq LLM_PROVIDER=groq GROQ_API_KEY=test-key
 *     GROQ_BASE_URL=http://127.0.0.1:4010/openai/v1 AUDIO_STORE=postgres ALLOWED_EMAILS=owner@example.com
 * This checks our wiring and request shape only; it does not prove Groq's real API accepts them.
 */
const FREE_URL = process.env.FREE_URL || 'http://localhost:3003';
const FAKE_URL = process.env.FAKE_API_URL || 'http://127.0.0.1:4010';
test.skip(!!process.env.SKIP_FREE_SERVER, 'free-stack server not running');

test('free stack: sign-up allowlist, Groq transcription and notes, audio kept in Postgres', async () => {
  const api = await request.newContext({ baseURL: FREE_URL });
  const stranger = await api.post('/api/auth/register', { data: { name: 'X', email: `x-${Date.now()}@example.com`, password: 'password123' } });
  expect(stranger.status()).toBe(403);

  const creds = { email: 'owner@example.com', password: 'password123' };
  const reg = await api.post('/api/auth/register', { data: { name: 'Owner', ...creds } });
  if (reg.status() === 409) expect((await api.post('/api/auth/login', { data: creds })).ok()).toBeTruthy();
  else expect(reg.ok()).toBeTruthy();

  const health = await (await api.get('/api/health')).json();
  expect(health.transcription).toMatchObject({ id: 'groq', ready: true, isDemo: false });
  expect(health.ai).toMatchObject({ id: 'groq', ready: true });

  const r = await api.post('/api/meetings', { data: { title: 'Budget sync', meetingType: 'Internal Meeting', mode: 'offline', consent: true, timezone: 'Asia/Kolkata', participants: [{ name: 'Priya' }] } });
  expect(r.status()).toBe(201);
  const id = (await r.json()).meeting.id as string;
  await api.post(`/api/meetings/${id}/state`, { data: { action: 'start' } });
  const audio = Buffer.from('fake-webm-audio-bytes'.repeat(100));
  const up = await api.post(`/api/meetings/${id}/segments`, {
    multipart: { audio: { name: 'a.webm', mimeType: 'audio/webm', buffer: audio }, seq: '0', startMs: '0', durationMs: '20000', silent: '0' },
  });
  expect(up.ok()).toBeTruthy();

  const t = await (await api.get(`/api/meetings/${id}/transcript`)).json();
  expect(t.total).toBe(1);
  expect(JSON.stringify(t)).toContain('Priya will send the budget report by Friday.');

  // Audio is stored in the database and served back byte for byte.
  const back = await api.get(`/api/meetings/${id}/audio?chunk=0`);
  expect(back.ok()).toBeTruthy();
  expect(Buffer.compare(await back.body(), audio)).toBe(0);

  await api.post(`/api/meetings/${id}/state`, { data: { action: 'stop', durationSeconds: 20 } });
  let d: any;
  for (let i = 0; i < 60; i++) {
    d = await (await api.get(`/api/meetings/${id}`)).json();
    if (d.meeting.status === 'COMPLETED' && d.notes?.is_final) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  expect(d.meeting.status).toBe('COMPLETED');
  expect(d.meeting.error).toBeFalsy();
  expect(d.notes.summary).toContain('budget review');
  expect(d.actions.map((a: any) => a.owner)).toContain('Priya');

  // Delete audio, keep transcript.
  expect((await api.delete(`/api/meetings/${id}/audio`)).ok()).toBeTruthy();
  expect((await api.get(`/api/meetings/${id}/audio?chunk=0`)).status()).toBe(404);
  expect((await (await api.get(`/api/meetings/${id}/transcript`)).json()).total).toBe(1);

  const log = await (await (await request.newContext()).get(`${FAKE_URL}/__log`)).json();
  const stt = log.find((e: any) => e.path === '/openai/v1/audio/transcriptions');
  expect(stt).toMatchObject({ auth: 'Bearer test-key', model: 'whisper-large-v3-turbo', format: 'verbose_json' });
  const chats = log.filter((e: any) => e.path === '/openai/v1/chat/completions');
  expect(chats.length).toBeGreaterThanOrEqual(2); // first was rate-limited and retried
  expect(chats[chats.length - 1]).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low', include_reasoning: false, strict: true });
});
