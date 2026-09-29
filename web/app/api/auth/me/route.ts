import { route, json, preflight } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const OPTIONS = preflight;
export const GET = route(async () => json({ user: await requireUser() }));
