import 'server-only';
import { q } from './db';
import { audioStore } from './audio-store';

/** Deletes a meeting's audio but keeps transcript and notes. */
export async function deleteMeetingAudio(meetingId: string) {
  await audioStore.deletePrefix(meetingId);
  await q('update audio_chunks set storage_key = null where meeting_id = $1', [meetingId]);
}

/** Removes audio older than each owner's retention window. Safe to call often. */
export async function purgeExpiredAudio(userId?: string) {
  const rows = await q<{ id: string }>(
    `select distinct m.id from meetings m join user_settings s on s.user_id = m.created_by
     join audio_chunks a on a.meeting_id = m.id and a.storage_key is not null
     where s.retention_days is not null and coalesce(m.end_time, m.created_at) < now() - (s.retention_days || ' days')::interval
     ${userId ? 'and m.created_by = $1' : ''}`,
    userId ? [userId] : [],
  );
  for (const r of rows) await deleteMeetingAudio(r.id);
  return rows.length;
}
