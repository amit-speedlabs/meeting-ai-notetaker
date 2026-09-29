import { z } from 'zod';
import { route, json, preflight } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { tx } from '@/lib/db';
import { requireMeeting, logActivity } from '@/lib/meetings';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

const Body = z.object({
  participants: z.array(z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().max(200).nullish(), organisation: z.string().trim().max(200).nullish() })).max(100),
});

export const PUT = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const b = Body.parse(await req.json());
  await tx(async (c) => {
    await c.query('delete from participants where meeting_id = $1', [m.id]);
    for (const p of b.participants) await c.query('insert into participants (meeting_id, name, email, organisation) values ($1,$2,$3,$4)', [m.id, p.name, p.email || null, p.organisation || null]);
  });
  await logActivity(m.id, u.id, 'participants_updated', { count: b.participants.length });
  return json({ ok: true });
});
