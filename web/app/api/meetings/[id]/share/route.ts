import { route, json } from '@/lib/http';
import { requireUser, randomToken } from '@/lib/auth';
import { q } from '@/lib/db';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { config } from '@/lib/config';

type Ctx = { params: Promise<{ id: string }> };

/** Creates (or returns) a read-only summary link. Anyone with the link can view the summary, not the transcript or audio. */
export const POST = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  let token = m.share_token;
  if (!token) {
    token = randomToken(18);
    await q('update meetings set share_token = $2 where id = $1', [m.id, token]);
    await logActivity(m.id, u.id, 'share_link_created');
  }
  return json({ url: `${config.appUrl}/share/${token}` });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  await q('update meetings set share_token = null where id = $1', [m.id]);
  await logActivity(m.id, u.id, 'share_link_revoked');
  return json({ ok: true });
});
