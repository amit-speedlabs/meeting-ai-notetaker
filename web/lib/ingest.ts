import 'server-only';
import { one, q } from './db';
import { HttpError } from './http';
import { audioStore } from './audio-store';
import { createTranscriptionProvider } from './transcription';
import { TranscriptionError } from './transcription/types';
import { MeetingRow, touch } from './meetings';

export type ChunkInput = { seq: number; startMs: number; durationMs: number; mime: string; data: Buffer; silent: boolean };

const ACTIVE = ['NOT_STARTED', 'RECORDING', 'PAUSED', 'PROCESSING'];

export async function ingestChunk(m: MeetingRow, c: ChunkInput) {
  if (!ACTIVE.includes(m.status)) throw new HttpError(409, `Meeting is ${m.status.toLowerCase()}; no more audio accepted`);
  const existing = await one<{ status: string }>('select status from audio_chunks where meeting_id = $1 and chunk_seq = $2', [m.id, c.seq]);
  if (existing && existing.status !== 'failed') return { duplicate: true, segments: [] }; // idempotent retry

  const key = m.store_audio ? `${m.id}/${String(c.seq).padStart(6, '0')}.${ext(c.mime)}` : null;
  if (key) await audioStore.put(key, c.data);
  await q(
    `insert into audio_chunks (meeting_id, chunk_seq, start_ms, duration_ms, mime, bytes, storage_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,'received')
     on conflict (meeting_id, chunk_seq) do update set status='received', error=null, storage_key=excluded.storage_key`,
    [m.id, c.seq, c.startMs, c.durationMs, c.mime, c.data.length, key],
  );

  // Browser-speech meetings upload audio only for retention; text arrives separately.
  if (m.transcription_provider === 'browser') {
    await q(`update audio_chunks set status='skipped' where meeting_id=$1 and chunk_seq=$2`, [m.id, c.seq]);
    await touch(m.id);
    return { skipped: 'browser_transcription', segments: [] };
  }
  if (c.silent || c.data.length < 1000) {
    await q(`update audio_chunks set status='skipped' where meeting_id=$1 and chunk_seq=$2`, [m.id, c.seq]);
    await touch(m.id);
    return { skipped: 'silence', segments: [] };
  }

  const provider = createTranscriptionProvider();
  let pieces;
  try {
    await provider.start({ meetingId: m.id });
    await provider.sendAudioChunk({ seq: c.seq, data: c.data, mime: c.mime, startMs: c.startMs, durationMs: c.durationMs });
    pieces = await provider.receiveTranscript();
  } catch (e: any) {
    const retryable = e instanceof TranscriptionError ? e.retryable : true;
    await q(`update audio_chunks set status='failed', error=$3 where meeting_id=$1 and chunk_seq=$2`, [m.id, c.seq, String(e.message).slice(0, 500)]);
    await q(`update meetings set error=$2 where id=$1`, [m.id, `Transcription error: ${String(e.message).slice(0, 300)}`]);
    throw new HttpError(retryable ? 503 : 502, `Transcription failed: ${e.message}`, retryable ? 'transcription_retry' : 'transcription_failed');
  }

  const rows = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const r = await one(
      `insert into transcript_segments (meeting_id, seq, offset_ms, speaker, text, confidence, chunk_seq)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (meeting_id, seq) do nothing
       returning seq, offset_ms, speaker, text, confidence`,
      [m.id, c.seq * 1000 + i, c.startMs + p.startMs, p.speaker, p.text, p.confidence, c.seq],
    );
    if (r) rows.push(r);
  }
  await q(`update audio_chunks set status='transcribed' where meeting_id=$1 and chunk_seq=$2`, [m.id, c.seq]);
  await q(
    `update meetings set transcription_status = case when status='PAUSED' then 'PAUSED' when status in ('RECORDING','NOT_STARTED') then 'TRANSCRIBING' else transcription_status end,
       transcription_provider = $2, error = case when error like 'Transcription error%' then null else error end where id=$1`,
    [m.id, provider.id],
  );
  await touch(m.id);
  return { segments: rows, isDemo: provider.isDemo };
}

/** Text produced client-side (browser speech recognition). */
export async function appendText(m: MeetingRow, items: { seq: number; offsetMs: number; text: string; confidence: number | null; speaker?: string | null }[]) {
  if (!ACTIVE.includes(m.status)) throw new HttpError(409, 'Meeting is not active');
  const rows = [];
  for (const it of items) {
    const text = it.text.trim();
    if (!text) continue;
    const r = await one(
      `insert into transcript_segments (meeting_id, seq, offset_ms, speaker, text, confidence)
       values ($1,$2,$3,$4,$5,$6) on conflict (meeting_id, seq) do nothing returning seq, offset_ms, speaker, text, confidence`,
      [m.id, it.seq, it.offsetMs, it.speaker ?? null, text.slice(0, 5000), it.confidence],
    );
    if (r) rows.push(r);
  }
  await q(`update meetings set transcription_status='TRANSCRIBING', transcription_provider='browser' where id=$1 and status in ('RECORDING','NOT_STARTED')`, [m.id]);
  await touch(m.id);
  return rows;
}

function ext(mime: string) {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}
