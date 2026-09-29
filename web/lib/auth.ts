import 'server-only';
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { q, one } from './db';
import { HttpError } from './http';

export const SESSION_COOKIE = 'mt_session';
const SESSION_DAYS = 14;

export type User = { id: string; email: string; name: string; role: 'user' | 'admin' };

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
export function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))),
  );
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 }, (e, k) =>
      e ? rej(e) : res(k),
    ),
  );
  return crypto.timingSafeEqual(key, expected);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await q('insert into sessions (user_id, token_hash, expires_at) values ($1,$2,$3)', [userId, sha256(token), expires]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await q('delete from sessions where token_hash = $1', [sha256(t)]);
  jar.delete(SESSION_COOKIE);
}

/** Resolves the current user from the session cookie or an extension Bearer token. */
export async function currentUser(): Promise<User | null> {
  const h = await headers();
  const authz = h.get('authorization');
  if (authz?.startsWith('Bearer ')) {
    const tok = authz.slice(7).trim();
    const row = await one<User & { token_id: string }>(
      `select u.id, u.email, u.name, u.role, t.id as token_id from api_tokens t join users u on u.id = t.user_id
       where t.token_hash = $1 and t.revoked_at is null`,
      [sha256(tok)],
    );
    if (!row) return null;
    q('update api_tokens set last_used_at = now() where id = $1', [row.token_id]).catch(() => {});
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return null;
  return one<User>(
    `select u.id, u.email, u.name, u.role from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(t)],
  );
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Not signed in', 'unauthenticated');
  return u;
}

export async function ensureSettings(userId: string) {
  await q('insert into user_settings (user_id) values ($1) on conflict do nothing', [userId]);
}

/** Signed state for OAuth CSRF protection. */
export function signState(payload: string) {
  const mac = crypto.createHmac('sha256', process.env.AUTH_SECRET || 'dev-insecure-secret').update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
export function verifyState(state: string): string | null {
  const i = state.lastIndexOf('.');
  if (i < 0) return null;
  const payload = state.slice(0, i);
  const expected = signState(payload);
  const a = Buffer.from(expected), b = Buffer.from(state);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? payload : null;
}
