import { z } from 'zod';
import { route, json } from '@/lib/http';
import { requireUser, randomToken, sha256 } from '@/lib/auth';
import { q, one } from '@/lib/db';

export const GET = route(async () => {
  const u = await requireUser();
  return json({ tokens: await q('select id, name, created_at, last_used_at from api_tokens where user_id = $1 and revoked_at is null order by created_at desc', [u.id]) });
});

/** Creates a personal access token for the Chrome extension. The raw token is shown once. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const { name } = z.object({ name: z.string().trim().min(1).max(100).default('Chrome extension') }).parse(await req.json().catch(() => ({})));
  const token = `mtk_${randomToken(32)}`;
  const row = await one('insert into api_tokens (user_id, name, token_hash) values ($1,$2,$3) returning id, name, created_at', [u.id, name, sha256(token)]);
  return json({ token, ...row }, 201);
});
