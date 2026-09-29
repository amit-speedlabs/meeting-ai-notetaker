import { route, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { globalSearch } from '@/lib/search';

export const GET = route(async (req) => {
  const u = await requireUser();
  const term = new URL(req.url).searchParams.get('q')?.trim() || '';
  return json(await globalSearch(u.id, term));
});
