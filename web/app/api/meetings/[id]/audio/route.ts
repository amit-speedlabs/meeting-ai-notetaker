import { route, json, preflight, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { audioStore } from '@/lib/audio-store';
import { deleteMeetingAudio } from '@/lib/retention';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

/** Without ?chunk: list of stored chunks. With ?chunk=N: the audio bytes of that chunk. */
export const GET = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const chunk = new URL(req.url).searchParams.get('chunk');
  if (chunk === null) {
    const rows = await q('select chunk_seq, start_ms, duration_ms, mime from audio_chunks where meeting_id = $1 and storage_key is not null order by chunk_seq', [m.id]);
    return json({ chunks: rows });
  }
  const row = await one<{ storage_key: string | null; mime: string }>('select storage_key, mime from audio_chunks where meeting_id = $1 and chunk_seq = $2', [m.id, Number(chunk)]);
  if (!row?.storage_key) throw new HttpError(404, 'Audio not available');
  const data = await audioStore.get(row.storage_key);
  if (!data) throw new HttpError(404, 'Audio not available');
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': row.mime.split(';')[0], 'Cache-Control': 'private, max-age=3600' } });
});

/** Delete audio, keep transcript and notes. */
export const DELETE = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  await deleteMeetingAudio(m.id);
  await logActivity(m.id, u.id, 'audio_deleted');
  return json({ ok: true });
});
