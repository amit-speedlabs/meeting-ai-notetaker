import { route, json, HttpError } from '@/lib/http';
import { purgeExpiredAudio } from '@/lib/retention';

/** Call on a schedule (e.g. Vercel Cron) with Authorization: Bearer $CRON_SECRET. */
export const POST = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized');
  return json({ purgedMeetings: await purgeExpiredAudio() });
});
export const GET = POST;

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
