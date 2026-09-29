import { z } from 'zod';
import { route, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { requireAction } from '@/lib/actions';
import { q, one } from '@/lib/db';
import { logActivity } from '@/lib/meetings';

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  task: z.string().trim().min(1).max(500).optional(),
  owner: z.string().trim().min(1).max(100).optional(),
  deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deadlineText: z.string().trim().max(100).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const a = await requireAction(u, (await params).id);
  const b = Patch.parse(await req.json());
  const changes: Record<string, [unknown, unknown]> = {};
  const set: string[] = [];
  const vals: unknown[] = [a.id];
  const put = (col: string, v: unknown) => {
    vals.push(v);
    set.push(`${col} = $${vals.length}`);
  };
  if (b.task !== undefined && b.task !== a.task) (put('task', b.task), (changes.task = [a.task, b.task]));
  if (b.owner !== undefined && b.owner !== a.owner) (put('owner', b.owner), (changes.owner = [a.owner, b.owner]));
  if (b.deadlineDate !== undefined) {
    put('deadline_date', b.deadlineDate);
    put('deadline_text', b.deadlineText || b.deadlineDate || 'Not specified');
    changes.deadline = [a.deadline_text, b.deadlineDate];
  }
  if (b.status !== undefined && b.status !== a.status) (put('status', b.status), (changes.status = [a.status, b.status]));
  if (!set.length) return json({ action: a });
  const row = await one(`update action_items set ${set.join(', ')}, user_edited = true, updated_at = now() where id = $1 returning *`, vals);
  await logActivity(a.meeting_id, u.id, 'action_updated', { task: row.task, changes });
  return json({ action: row });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const a = await requireAction(u, (await params).id);
  await q('delete from action_items where id = $1', [a.id]);
  await logActivity(a.meeting_id, u.id, 'action_deleted', { task: a.task });
  return json({ ok: true });
});
