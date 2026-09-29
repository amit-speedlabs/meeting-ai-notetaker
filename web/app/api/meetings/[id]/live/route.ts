import { route, json, preflight } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { requireMeeting } from '@/lib/meetings';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

/** Polled by the live page and the extension popup: status, new transcript since cursor, current notes. */
export const GET = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const s = new URL(req.url).searchParams;
  const after = Number(s.get('after') ?? -1);
  const segments = await q(
    'select seq, offset_ms, speaker, text, confidence from transcript_segments where meeting_id = $1 and seq > $2 order by seq limit 300',
    [m.id, after],
  );
  const notes = await one('select * from notes where meeting_id = $1', [m.id]);
  const actions = await q(`select id, task, owner, deadline_date, deadline_text, status from action_items where meeting_id = $1 and status <> 'cancelled' order by created_at`, [m.id]);
  const chunks = await one(`select count(*) filter (where status='failed')::int as failed, count(*)::int as total, coalesce(max(chunk_seq), -1)::int as max_seq from audio_chunks where meeting_id=$1`, [m.id]);
  return json({
    meeting: { id: m.id, title: m.title, status: m.status, transcription_status: m.transcription_status, error: m.error, start_time: m.start_time, duration_seconds: m.duration_seconds, speaker_map: m.speaker_map, transcription_provider: m.transcription_provider, llm_provider: m.llm_provider, timezone: m.timezone, notes_updated_at: m.notes_updated_at },
    segments,
    notes,
    actions,
    chunks,
  });
});
