import 'server-only';
import { one, q } from './db';
import { HttpError } from './http';
import type { User } from './auth';

export const MEETING_TYPES = [
  'Internal Meeting', 'Client Meeting', 'School Meeting', 'Partner Meeting', 'Sales Meeting',
  'Project Meeting', 'Interview', 'Brainstorming', 'Review Meeting', 'Other',
];

export type MeetingRow = {
  id: string; created_by: string; title: string; meeting_type: string; mode: 'meet' | 'offline' | 'upload';
  status: string; transcription_status: string; start_time: string | null; end_time: string | null;
  duration_seconds: number; speaker_map: Record<string, string>; transcription_provider: string | null;
  llm_provider: string | null; store_audio: boolean; is_demo: boolean; share_token: string | null;
  notes_cursor: number; notes_updated_at: string | null; last_activity_at: string | null; error: string | null;
  meet_code: string | null; timezone: string; created_at: string; updated_at: string;
};

/** Loads a meeting and enforces ownership (the single access-control check for meeting data). */
export async function requireMeeting(user: User, id: string): Promise<MeetingRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Meeting not found');
  const m = await one<MeetingRow>('select * from meetings where id = $1', [id]);
  if (!m || (m.created_by !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Meeting not found');
  return m;
}

export async function logActivity(meetingId: string, userId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  await q('insert into activity_log (meeting_id, user_id, kind, detail) values ($1,$2,$3,$4)', [meetingId, userId, kind, JSON.stringify(detail)]);
}

export function speakerName(map: Record<string, string>, label: string | null) {
  if (!label) return 'Unknown Speaker';
  return map[label] || label;
}

export function fmtOffset(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export function clockTime(start: string | null, offsetMs: number, tz: string) {
  if (!start) return fmtOffset(offsetMs);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(
      new Date(new Date(start).getTime() + offsetMs),
    );
  } catch {
    return fmtOffset(offsetMs);
  }
}

export async function touch(meetingId: string) {
  await q('update meetings set last_activity_at = now(), updated_at = now() where id = $1', [meetingId]);
}
