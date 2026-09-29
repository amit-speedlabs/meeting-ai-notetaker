import { z } from 'zod';
import { route, json, preflight } from '@/lib/http';
import { requireUser, ensureSettings } from '@/lib/auth';
import { one, q, tx } from '@/lib/db';
import { listMeetings } from '@/lib/meeting-queries';
import { MEETING_TYPES, logActivity } from '@/lib/meetings';
import { transcriptionProviderInfo } from '@/lib/transcription';
import { llmProviderInfo } from '@/lib/llm';

export const OPTIONS = preflight;

export const GET = route(async (req) => {
  const u = await requireUser();
  const s = new URL(req.url).searchParams;
  const rows = await listMeetings(u.id, {
    from: s.get('from') || undefined, to: s.get('to') || undefined, type: s.get('type') || undefined,
    participant: s.get('participant') || undefined, owner: s.get('owner') || undefined, status: s.get('status') || undefined,
    q: s.get('q') || undefined, sort: (s.get('sort') as any) || 'newest',
    limit: Number(s.get('limit')) || 50, offset: Number(s.get('offset')) || 0,
  });
  return json({ meetings: rows });
});

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  meetingType: z.enum(MEETING_TYPES as [string, ...string[]]).default('Other'),
  mode: z.enum(['meet', 'offline', 'upload']),
  timezone: z.string().max(64).default('UTC'),
  meetCode: z.string().max(64).optional(),
  consent: z.literal(true, { message: 'Recording consent must be confirmed' }),
  transcription: z.enum(['server', 'browser']).default('server'),
  participants: z.array(z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().max(200).optional().or(z.literal('')), organisation: z.string().trim().max(200).optional().or(z.literal('')) })).max(100).default([]),
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = Create.parse(await req.json());
  let tz = b.timezone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  await ensureSettings(u.id);
  const settings = await one<{ store_audio: boolean }>('select store_audio from user_settings where user_id = $1', [u.id]);
  const tp = transcriptionProviderInfo();
  const lp = llmProviderInfo();
  const m = await tx(async (c) => {
    const r = await c.query(
      `insert into meetings (created_by, title, meeting_type, mode, timezone, meet_code, store_audio, transcription_provider, llm_provider)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [u.id, b.title, b.meetingType, b.mode, tz, b.meetCode || null, settings?.store_audio ?? true, b.transcription === 'browser' ? 'browser' : tp.id, lp.id],
    );
    for (const p of b.participants) {
      await c.query('insert into participants (meeting_id, name, email, organisation) values ($1,$2,$3,$4)', [r.rows[0].id, p.name, p.email || null, p.organisation || null]);
    }
    return r.rows[0];
  });
  await logActivity(m.id, u.id, 'created', { mode: b.mode, consent: true, transcription: b.transcription === 'browser' ? 'browser' : tp.id });
  return json({ meeting: m, providers: { transcription: tp, ai: lp } }, 201);
});
