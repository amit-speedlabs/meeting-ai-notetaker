import 'server-only';
import { q } from './db';

/** Global search across titles, transcripts, participants, notes and action items. */
export async function globalSearch(userId: string, term: string) {
  if (!term) return { transcript: [], meetings: [], actions: [] };
  const transcript = await q(
    `select t.meeting_id, t.seq, t.offset_ms, t.speaker, t.text, m.title, m.start_time, m.timezone, m.speaker_map, m.is_demo,
       ts_headline('english', t.text, plainto_tsquery('english', $2), 'StartSel=«, StopSel=», HighlightAll=true') as highlight,
       ts_rank(t.tsv, plainto_tsquery('english', $2)) as rank
     from transcript_segments t join meetings m on m.id = t.meeting_id
     where m.created_by = $1 and (t.tsv @@ plainto_tsquery('english', $2) or t.text ilike '%' || $2 || '%' or t.speaker ilike $2
       or exists (select 1 from jsonb_each_text(m.speaker_map) s where s.key = t.speaker and s.value ilike '%' || $2 || '%'))
     order by rank desc, m.start_time desc nulls last, t.seq limit 100`,
    [userId, term],
  );
  const meetings = await q(
    `select m.id, m.title, m.start_time, m.meeting_type, m.is_demo,
       case when m.title ilike '%' || $2 || '%' then 'title'
            when exists (select 1 from participants p where p.meeting_id = m.id and p.name ilike '%' || $2 || '%') then 'participant'
            else 'notes' end as matched
     from meetings m left join notes n on n.meeting_id = m.id
     where m.created_by = $1 and (m.title ilike '%' || $2 || '%' or n.summary ilike '%' || $2 || '%' or n.decisions::text ilike '%' || $2 || '%'
       or exists (select 1 from participants p where p.meeting_id = m.id and p.name ilike '%' || $2 || '%'))
     order by m.start_time desc nulls last limit 50`,
    [userId, term],
  );
  const actions = await q(
    `select a.id, a.task, a.owner, a.deadline_date, a.deadline_text, a.status, a.meeting_id, m.title
     from action_items a join meetings m on m.id = a.meeting_id
     where m.created_by = $1 and (a.task ilike '%' || $2 || '%' or a.owner ilike '%' || $2 || '%') order by a.created_at desc limit 50`,
    [userId, term],
  );
  return { transcript, meetings, actions };
}
