import 'server-only';
import { one, q, pool } from './db';
import { createLLMProvider } from './llm';
import { HeuristicNotes } from './llm/heuristic';
import { EMPTY_NOTES, NotesJSON, TranscriptLine, ExtractedAction } from './llm/types';
import { resolveDeadline, localDate, NOT_SPECIFIED } from './deadline';
import { MeetingRow, speakerName, clockTime, logActivity } from './meetings';
import { config } from './config';

type Seg = { seq: number; offset_ms: number; speaker: string | null; text: string };

async function withLock<T>(meetingId: string, fn: () => Promise<T>): Promise<T | null> {
  const c = await pool.connect();
  try {
    const r = await c.query('select pg_try_advisory_lock(hashtext($1)) as ok', [meetingId]);
    if (!r.rows[0].ok) return null;
    try {
      return await fn();
    } finally {
      await c.query('select pg_advisory_unlock(hashtext($1))', [meetingId]);
    }
  } finally {
    c.release();
  }
}

async function context(m: MeetingRow) {
  const participants = (await q<{ name: string }>('select name from participants where meeting_id = $1', [m.id])).map((p) => p.name);
  return {
    title: m.title,
    type: m.meeting_type,
    date: localDate(m.start_time ? new Date(m.start_time) : new Date(m.created_at), m.timezone),
    participants: [...new Set([...participants, ...Object.values(m.speaker_map || {})])],
  };
}

function toLines(m: MeetingRow, segs: Seg[]): TranscriptLine[] {
  return segs.map((s) => ({ time: clockTime(m.start_time, s.offset_ms, m.timezone), speaker: speakerName(m.speaker_map || {}, s.speaker), text: s.text }));
}

async function loadNotes(meetingId: string): Promise<NotesJSON | null> {
  const n = await one('select * from notes where meeting_id = $1', [meetingId]);
  if (!n) return null;
  const actions = await q<{ task: string; owner: string; deadline_text: string; source_quote: string | null }>(
    `select task, owner, deadline_text, source_quote from action_items where meeting_id = $1 and status <> 'cancelled' order by created_at`,
    [meetingId],
  );
  return {
    summary: n.summary,
    discussion_points: n.key_points,
    decisions: n.decisions,
    open_questions: n.open_questions,
    risks: n.risks,
    follow_ups: n.follow_ups,
    important_numbers: n.important_numbers,
    topics: n.topics,
    next_steps: n.next_steps,
    action_items: actions.map((a) => ({ task: a.task, owner: a.owner, deadline_text: a.deadline_text, source_quote: a.source_quote || '' })),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Owner is kept only if the name is actually present in the meeting; otherwise "Unassigned". */
export function validateOwner(owner: string, knownNames: string[], transcriptText: string): string {
  const o = (owner || '').trim();
  if (!o || /^(unassigned|unknown|none|n\/a|tbd|team|everyone|we|someone)$/i.test(o)) return 'Unassigned';
  const lower = o.toLowerCase();
  if (knownNames.some((n) => n.toLowerCase() === lower)) return o;
  const esc = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${esc}\\b`, 'i').test(transcriptText)) return o;
  return 'Unassigned';
}

async function saveNotes(m: MeetingRow, notes: NotesJSON, isFinal: boolean, providerId: string, allSegs: Seg[]) {
  const ctx = await context(m);
  const transcriptText = allSegs.map((s) => s.text).join('\n');
  const known = [...ctx.participants, ...new Set(allSegs.map((s) => speakerName(m.speaker_map || {}, s.speaker)))];
  await q(
    `insert into notes (meeting_id, summary, key_points, decisions, open_questions, risks, follow_ups, important_numbers, topics, next_steps, is_final, provider, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (meeting_id) do update set summary=$2, key_points=$3, decisions=$4, open_questions=$5, risks=$6, follow_ups=$7,
       important_numbers=$8, topics=$9, next_steps=$10, is_final=$11, provider=$12, updated_at=now()`,
    [m.id, notes.summary, J(notes.discussion_points), J(notes.decisions), J(notes.open_questions), J(notes.risks), J(notes.follow_ups),
      J(notes.important_numbers), J(notes.topics), J(notes.next_steps), isFinal, providerId],
  );
  if (isFinal) {
    // The final pass is authoritative for AI items the user has not touched.
    await q(`delete from action_items where meeting_id = $1 and source = 'ai' and user_edited = false and status = 'pending'`, [m.id]);
  }
  const existing = await q<{ task: string }>('select task from action_items where meeting_id = $1', [m.id]);
  const seen = new Set(existing.map((e) => norm(e.task)));
  for (const a of notes.action_items) {
    const k = norm(a.task);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const owner = validateOwner(a.owner, known, transcriptText);
    const dl = resolveDeadline(a.deadline_text, ctx.date);
    await q(
      `insert into action_items (meeting_id, task, owner, deadline_date, deadline_text, source, source_quote) values ($1,$2,$3,$4,$5,'ai',$6)`,
      [m.id, a.task, owner, dl.date, dl.text || NOT_SPECIFIED, a.source_quote || null],
    );
  }
  await q('update meetings set notes_updated_at = now() where id = $1', [m.id]);
}

const J = (v: unknown) => JSON.stringify(v ?? []);

/** Incremental pass: only transcript lines after notes_cursor are sent to the model. */
export async function runIncremental(meetingId: string, opts: { force?: boolean } = {}) {
  return withLock(meetingId, async () => {
    const m = await one<MeetingRow>('select * from meetings where id = $1', [meetingId]);
    if (!m) return null;
    const newSegs = await q<Seg>('select seq, offset_ms, speaker, text from transcript_segments where meeting_id = $1 and seq > $2 order by seq', [m.id, m.notes_cursor]);
    if (!newSegs.length) return { skipped: true };
    const lastRun = m.notes_updated_at ? new Date(m.notes_updated_at).getTime() : 0;
    const due = opts.force || newSegs.length >= config.notesIntervalSegments || Date.now() - lastRun > config.notesMaxWaitMs;
    if (!due) return { skipped: true };
    const existing = await loadNotes(m.id);
    try {
      const provider = createLLMProvider();
      const notes = await provider.generateNotes({ mode: 'incremental', meeting: await context(m), existing, lines: toLines(m, newSegs) });
      const allSegs = await q<Seg>('select seq, offset_ms, speaker, text from transcript_segments where meeting_id = $1 order by seq', [m.id]);
      await saveNotes(m, notes, false, provider.id, allSegs);
      await q('update meetings set notes_cursor = $2, error = null where id = $1', [m.id, newSegs[newSegs.length - 1].seq]);
      return { updated: true };
    } catch (e: any) {
      console.error('[notes] incremental pass failed', e);
      await q('update meetings set error = $2 where id = $1', [m.id, `AI notes temporarily unavailable: ${String(e.message || e).slice(0, 300)}`]);
      return { error: String(e.message || e) };
    }
  });
}

/**
 * Final pass, run once when the meeting stops. Short meetings: one call with the whole transcript.
 * Long meetings: windows are folded into running notes, then a reduce call writes the summary, so
 * the full transcript is never sent in one request.
 */
export async function runFinal(meetingId: string) {
  const res = await withLock(meetingId, async () => {
    const m = await one<MeetingRow>('select * from meetings where id = $1', [meetingId]);
    if (!m) return null;
    const segs = await q<Seg>('select seq, offset_ms, speaker, text from transcript_segments where meeting_id = $1 order by seq', [m.id]);
    if (!segs.length) {
      await saveNotes(m, { ...EMPTY_NOTES, summary: 'No speech was captured in this meeting.' }, true, 'none', segs);
      return { empty: true };
    }
    const ctx = await context(m);
    const lines = toLines(m, segs);
    const totalChars = lines.reduce((n, l) => n + l.text.length + l.speaker.length + 12, 0);
    let provider;
    try {
      provider = createLLMProvider();
    } catch (e: any) {
      provider = new HeuristicNotes();
      await logActivity(m.id, null, 'notes_fallback', { reason: String(e.message || e) });
    }
    try {
      let notes: NotesJSON;
      if (totalChars <= config.finalPassMaxChars) {
        notes = await provider.generateNotes({ mode: 'final', meeting: ctx, existing: null, lines });
      } else {
        let running: NotesJSON | null = null;
        const windowChars = Math.floor(config.finalPassMaxChars / 2);
        let window: TranscriptLine[] = [];
        let size = 0;
        const flush = async () => {
          if (!window.length) return;
          running = await provider!.generateNotes({ mode: 'incremental', meeting: ctx, existing: running, lines: compress(window) });
          window = [];
          size = 0;
        };
        for (const l of lines) {
          window.push(l);
          size += l.text.length + 20;
          if (size >= windowChars) await flush();
        }
        await flush();
        notes = await provider.generateNotes({ mode: 'reduce', meeting: ctx, existing: running, lines: [] });
      }
      await saveNotes(m, notes, true, provider.id, segs);
      await q('update meetings set notes_cursor = $2, error = null where id = $1', [m.id, segs[segs.length - 1].seq]);
      return { ok: true };
    } catch (e: any) {
      console.error('[notes] final pass failed', e);
      await q('update meetings set error = $2 where id = $1', [m.id, `Final notes could not be generated: ${String(e.message || e).slice(0, 300)}. The transcript is saved; use "Regenerate notes" to retry.`]);
      return { error: String(e.message || e) };
    }
  });
  return res ?? { busy: true };
}

/** Merge consecutive lines by the same speaker and drop filler words (context compression). */
function compress(lines: TranscriptLine[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const l of lines) {
    const text = l.text.replace(/\b(um+|uh+|you know|i mean|like,)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.speaker === l.speaker) prev.text += ' ' + text;
    else out.push({ ...l, text });
  }
  return out;
}

export type { ExtractedAction };
