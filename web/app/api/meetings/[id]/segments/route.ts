import { after } from 'next/server';
import { route, json, preflight, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { requireMeeting } from '@/lib/meetings';
import { ingestChunk } from '@/lib/ingest';
import { runIncremental } from '@/lib/notes-engine';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;
const MAX_BYTES = 25 * 1024 * 1024;

export const POST = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const form = await req.formData();
  const file = form.get('audio');
  if (!(file instanceof Blob)) throw new HttpError(400, 'Missing audio');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Audio segment too large (max 25 MB)');
  const seq = Number(form.get('seq'));
  const startMs = Number(form.get('startMs'));
  const durationMs = Number(form.get('durationMs'));
  if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(startMs) || !Number.isFinite(durationMs)) throw new HttpError(400, 'Invalid segment metadata');
  const result = await ingestChunk(m, {
    seq,
    startMs: Math.round(startMs),
    durationMs: Math.round(durationMs),
    mime: file.type || 'audio/webm',
    data: Buffer.from(await file.arrayBuffer()),
    silent: form.get('silent') === '1',
  });
  if (result.segments.length && (m.status === 'RECORDING' || m.status === 'PAUSED')) after(() => runIncremental(m.id));
  return json(result);
});

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
