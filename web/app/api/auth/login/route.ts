import { z } from 'zod';
import { route, json, HttpError } from '@/lib/http';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { one } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

const Body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  rateLimit(`login:${clientIp(req)}:${b.email}`, 10);
  const u = await one<{ id: string; password_hash: string | null }>('select id, password_hash from users where email = $1', [b.email]);
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, 'Incorrect email or password');
  await createSession(u.id);
  return json({ ok: true });
});
