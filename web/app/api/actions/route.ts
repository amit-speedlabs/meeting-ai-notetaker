import { z } from 'zod';
import { route, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { resolveDeadline, localDate } from '@/lib/deadline';

/** Action items across the user's meetings. ?status=open|pending|...&owner=&meeting= */
export const GET = route(async (req) => {
  const u = await requireUser();
  const s = new URL(req.url).searchParams;
  const where = ['m.created_by = $1'];
  const params: unknown[] = [u.id];
  const status = s.get('status');
  if (status === 'open') where.push(`a.status in ('pending','in_progress')`);
  else if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (s.get('owner')) {
    params.push(s.get('owner'));
    where.push(`a.owner ilike '%' || $${params.length} || '%'`);
  }
  if (s.get('meeting')) {
    params.push(s.get('meeting'));
    where.push(`a.meeting_id = $${params.length}`);
  }
  const rows = await q(
    `select a.*, m.title as meeting_title, m.is_demo from action_items a join meetings m on m.id = a.meeting_id
     where ${where.join(' and ')} order by (a.deadline_date is null), a.deadline_date, a.created_at desc limit 500`,
    params,
  );
  return json({ actions: rows });
});

const Create = z.object({
  meetingId: z.string().uuid(),
  task: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(100).optional(),
  deadline: z.string().trim().max(100).optional(), // ISO date or phrase
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = Create.parse(await req.json());
  const m = await requireMeeting(u, b.meetingId);
  const base = localDate(m.start_time ? new Date(m.start_time) : new Date(m.created_at), m.timezone);
  const dl = /^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '') ? { date: b.deadline!, text: b.deadline! } : resolveDeadline(b.deadline, base);
  const a = await one(
    `insert into action_items (meeting_id, task, owner, deadline_date, deadline_text, source, user_edited) values ($1,$2,$3,$4,$5,'manual',true) returning *`,
    [m.id, b.task, b.owner || 'Unassigned', dl.date, dl.text],
  );
  await logActivity(m.id, u.id, 'action_added', { task: b.task });
  return json({ action: a }, 201);
});
