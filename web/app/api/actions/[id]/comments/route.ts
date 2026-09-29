import { z } from 'zod';
import { route, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { logActivity } from '@/lib/meetings';
import { requireAction } from '@/lib/actions';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const a = await requireAction(u, (await params).id);
  return json({ comments: await q('select c.id, c.body, c.created_at, u.name as user_name from action_comments c left join users u on u.id = c.user_id where c.action_id = $1 order by c.created_at', [a.id]) });
});

export const POST = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const a = await requireAction(u, (await params).id);
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(await req.json());
  const c = await one('insert into action_comments (action_id, user_id, body) values ($1,$2,$3) returning id, body, created_at', [a.id, u.id, body]);
  await logActivity(a.meeting_id, u.id, 'action_comment', { task: a.task });
  return json({ comment: { ...c, user_name: u.name } }, 201);
});
