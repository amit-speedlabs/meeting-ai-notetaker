import { route, json, preflight, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { runFinal, runIncremental } from '@/lib/notes-engine';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

/** Regenerate notes: an incremental pass during a meeting, a full final pass afterwards. */
export const POST = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  if (m.status === 'RECORDING' || m.status === 'PAUSED') return json(await runIncremental(m.id, { force: true }));
  if (m.status !== 'COMPLETED' && m.status !== 'FAILED') throw new HttpError(409, 'Notes are being generated');
  const r: any = await runFinal(m.id);
  await logActivity(m.id, u.id, 'notes_regenerated', r?.error ? { error: r.error } : {});
  return json(r);
});

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
