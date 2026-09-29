import { z } from 'zod';
import { after } from 'next/server';
import { route, json, preflight, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { runFinal } from '@/lib/notes-engine';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

const Body = z.object({
  action: z.enum(['start', 'pause', 'resume', 'stop', 'fail']),
  durationSeconds: z.number().int().min(0).max(24 * 3600).optional(),
  reason: z.string().max(500).optional(),
});

const ALLOWED: Record<string, string[]> = {
  start: ['NOT_STARTED'],
  pause: ['RECORDING'],
  resume: ['PAUSED'],
  stop: ['RECORDING', 'PAUSED', 'NOT_STARTED'],
  fail: ['NOT_STARTED', 'RECORDING', 'PAUSED'],
};

export const POST = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const b = Body.parse(await req.json());
  if (!ALLOWED[b.action].includes(m.status)) {
    // Idempotent: repeating the same transition is fine (e.g. a retried request).
    const same = { start: 'RECORDING', pause: 'PAUSED', resume: 'RECORDING', stop: 'PROCESSING', fail: 'FAILED' }[b.action];
    if (m.status === same || (b.action === 'stop' && m.status === 'COMPLETED')) return json({ meeting: m });
    throw new HttpError(409, `Cannot ${b.action} a meeting that is ${m.status}`);
  }
  const dur = b.durationSeconds;
  const durSql = dur !== undefined ? ', duration_seconds = greatest(duration_seconds, $2)' : '';
  const p: unknown[] = dur !== undefined ? [m.id, dur] : [m.id];
  switch (b.action) {
    case 'start':
      await q(`update meetings set status='RECORDING', transcription_status='TRANSCRIBING', start_time=coalesce(start_time, now()), last_activity_at=now(), updated_at=now() where id=$1`, [m.id]);
      break;
    case 'pause':
      await q(`update meetings set status='PAUSED', transcription_status='PAUSED', last_activity_at=now() ${durSql} where id=$1`, p);
      break;
    case 'resume':
      await q(`update meetings set status='RECORDING', transcription_status='TRANSCRIBING', last_activity_at=now() ${durSql} where id=$1`, p);
      break;
    case 'fail':
      await q(`update meetings set status='FAILED', transcription_status='FAILED', error=$2, end_time=now() where id=$1`, [m.id, b.reason || 'Capture failed']);
      break;
    case 'stop': {
      await q(
        `update meetings set status='PROCESSING', end_time=now(), last_activity_at=now(),
           duration_seconds = greatest(duration_seconds, coalesce($2, extract(epoch from (now() - coalesce(start_time, now())))::int)) where id=$1`,
        [m.id, dur ?? null],
      );
      after(() => finalize(m.id));
      break;
    }
  }
  await logActivity(m.id, u.id, b.action, b.reason ? { reason: b.reason } : {});
  return json({ meeting: await one('select * from meetings where id = $1', [m.id]) });
});

async function finalize(id: string) {
  // An incremental pass may still hold the lock; retry briefly.
  for (let i = 0; i < 20; i++) {
    const r: any = await runFinal(id);
    if (!r?.busy) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  const failed = await one<{ n: number }>(`select count(*)::int as n from audio_chunks where meeting_id=$1 and status='failed'`, [id]);
  await q(
    `update meetings set status='COMPLETED', transcription_status = case when $2 > 0 then 'FAILED' else 'COMPLETED' end, updated_at=now() where id=$1 and status='PROCESSING'`,
    [id, failed?.n || 0],
  );
}

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
