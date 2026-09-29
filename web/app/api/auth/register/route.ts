import { z } from 'zod';
import { route, json, HttpError } from '@/lib/http';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { one } from '@/lib/db';
import { config } from '@/lib/config';
import { hashPassword, createSession, ensureSettings } from '@/lib/auth';

const Body = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(200) });

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  rateLimit(`register:${clientIp(req)}:${b.email}`, 5);
  if (config.allowedEmails.length && !config.allowedEmails.includes(b.email)) throw new HttpError(403, 'Sign-up is limited to invited emails on this server');
  const exists = await one('select id from users where email = $1', [b.email]);
  if (exists) throw new HttpError(409, 'An account with this email already exists');
  const u = await one<{ id: string }>('insert into users (email, name, password_hash) values ($1,$2,$3) returning id', [b.email, b.name, await hashPassword(b.password)]);
  await ensureSettings(u!.id);
  await createSession(u!.id);
  return json({ ok: true });
});
