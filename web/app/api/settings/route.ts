import { z } from 'zod';
import { route, json } from '@/lib/http';
import { requireUser, ensureSettings } from '@/lib/auth';
import { q, one } from '@/lib/db';
import { purgeExpiredAudio } from '@/lib/retention';

export const GET = route(async () => {
  const u = await requireUser();
  await ensureSettings(u.id);
  return json({ settings: await one('select store_audio, retention_days from user_settings where user_id = $1', [u.id]) });
});

const Body = z.object({ storeAudio: z.boolean(), retentionDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.null()]) });

export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = Body.parse(await req.json());
  await ensureSettings(u.id);
  await q('update user_settings set store_audio = $2, retention_days = $3, updated_at = now() where user_id = $1', [u.id, b.storeAudio, b.retentionDays]);
  const purged = await purgeExpiredAudio(u.id);
  return json({ ok: true, purgedMeetings: purged });
});
