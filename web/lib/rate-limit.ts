import 'server-only';
import { HttpError } from './http';

// Simple in-memory limiter (per server instance). Use a shared store (e.g. Redis) when running several instances.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}

export function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
