import 'server-only';
import { q } from './db';

export type MeetingFilters = {
  from?: string; to?: string; type?: string; participant?: string; owner?: string; status?: string; q?: string;
  sort?: 'newest' | 'oldest' | 'longest' | 'shortest'; limit?: number; offset?: number;
};

export async function listMeetings(userId: string, f: MeetingFilters) {
  const where = ['m.created_by = $1'];
  const params: unknown[] = [userId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.from) add('coalesce(m.start_time, m.created_at) >= ?::date', f.from);
  if (f.to) add("coalesce(m.start_time, m.created_at) < (?::date + interval '1 day')", f.to);
  if (f.type) add('m.meeting_type = ?', f.type);
  if (f.status) add('m.status = ?', f.status);
  if (f.participant)
    add(
      `(exists (select 1 from participants p where p.meeting_id = m.id and p.name ilike '%' || ? || '%')
        or exists (select 1 from jsonb_each_text(m.speaker_map) s where s.value ilike '%' || $${params.length} || '%'))`,
      f.participant,
    );
  if (f.owner) add(`exists (select 1 from action_items a where a.meeting_id = m.id and a.owner ilike '%' || ? || '%')`, f.owner);
  if (f.q)
    add(
      `(m.title ilike '%' || ? || '%' or exists (select 1 from transcript_segments t where t.meeting_id = m.id and t.tsv @@ plainto_tsquery('english', $${params.length}))
        or exists (select 1 from notes n where n.meeting_id = m.id and n.summary ilike '%' || $${params.length} || '%'))`,
      f.q,
    );
  const order = {
    newest: 'coalesce(m.start_time, m.created_at) desc',
    oldest: 'coalesce(m.start_time, m.created_at) asc',
    longest: 'm.duration_seconds desc',
    shortest: 'm.duration_seconds asc',
  }[f.sort || 'newest'];
  params.push(Math.min(f.limit || 50, 200), f.offset || 0);
  return q(
    `select m.id, m.title, m.meeting_type, m.mode, m.status, m.start_time, m.created_at, m.duration_seconds, m.is_demo, m.last_activity_at,
       (select count(*) from participants p where p.meeting_id = m.id)::int as participant_count,
       (select count(distinct t.speaker) from transcript_segments t where t.meeting_id = m.id and t.speaker is not null)::int as speaker_count,
       (select count(*) from action_items a where a.meeting_id = m.id and a.status in ('pending','in_progress'))::int as open_actions
     from meetings m where ${where.join(' and ')} order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params,
  );
}
