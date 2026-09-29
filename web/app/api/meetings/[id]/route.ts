import { z } from 'zod';
import { route, json, preflight } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { requireMeeting, logActivity, MEETING_TYPES } from '@/lib/meetings';
import { audioStore } from '@/lib/audio-store';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

export const GET = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const [participants, notes, actions, activity, audio] = await Promise.all([
    q('select id, name, email, organisation from participants where meeting_id = $1 order by name', [m.id]),
    q('select * from notes where meeting_id = $1', [m.id]),
    q('select * from action_items where meeting_id = $1 order by created_at', [m.id]),
    q(`select a.kind, a.detail, a.created_at, u.name as user_name from activity_log a left join users u on u.id = a.user_id where a.meeting_id = $1 order by a.created_at desc limit 200`, [m.id]),
    q(`select count(*)::int as chunks, count(storage_key)::int as stored, coalesce(sum(bytes) filter (where storage_key is not null),0)::bigint as bytes from audio_chunks where meeting_id = $1`, [m.id]),
  ]);
  const speakers = await q<{ speaker: string | null; n: number }>('select speaker, count(*)::int as n from transcript_segments where meeting_id = $1 group by speaker order by min(seq)', [m.id]);
  return json({ meeting: m, participants, notes: notes[0] || null, actions, activity, audio: audio[0], speakers });
});

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  meetingType: z.enum(MEETING_TYPES as [string, ...string[]]).optional(),
  speakerMap: z.record(z.string().max(100), z.string().trim().max(100)).optional(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const b = Patch.parse(await req.json());
  if (b.title && b.title !== m.title) {
    await q('update meetings set title = $2, updated_at = now() where id = $1', [m.id, b.title]);
    await logActivity(m.id, u.id, 'renamed', { from: m.title, to: b.title });
  }
  if (b.meetingType && b.meetingType !== m.meeting_type) {
    await q('update meetings set meeting_type = $2, updated_at = now() where id = $1', [m.id, b.meetingType]);
    await logActivity(m.id, u.id, 'type_changed', { from: m.meeting_type, to: b.meetingType });
  }
  if (b.speakerMap) {
    const clean = Object.fromEntries(Object.entries(b.speakerMap).filter(([, v]) => v));
    await q('update meetings set speaker_map = $2, updated_at = now() where id = $1', [m.id, JSON.stringify(clean)]);
    // Owners recorded under a speaker label follow the rename.
    for (const [label, name] of Object.entries(clean)) {
      const prev = m.speaker_map?.[label] || label;
      await q('update action_items set owner = $3, updated_at = now() where meeting_id = $1 and owner = $2', [m.id, prev, name]);
    }
    await logActivity(m.id, u.id, 'speakers_renamed', { map: clean });
  }
  return json({ ok: true });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  await audioStore.deletePrefix(m.id);
  await q('delete from meetings where id = $1', [m.id]);
  return json({ ok: true });
});
