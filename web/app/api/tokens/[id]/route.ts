import { route, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';

export const DELETE = route(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const u = await requireUser();
  await q('update api_tokens set revoked_at = now() where id = $1 and user_id = $2', [(await params).id, u.id]);
  return json({ ok: true });
});
