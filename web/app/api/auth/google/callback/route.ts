import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { one } from '@/lib/db';
import { createSession, ensureSettings, verifyState } from '@/lib/auth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const jar = await cookies();
  const expected = jar.get('mt_oauth_state')?.value;
  jar.delete('mt_oauth_state');
  const fail = (e: string) => NextResponse.redirect(`${config.appUrl}/login?error=${e}`);
  if (!code || !expected || state !== expected || !verifyState(state)) return fail('oauth_state');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${config.appUrl}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail('oauth_token');
  const tok: any = await tokenRes.json();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!infoRes.ok) return fail('oauth_userinfo');
  const info: any = await infoRes.json();
  if (!info.email || !info.email_verified) return fail('email_unverified');

  const email = String(info.email).toLowerCase();
  if (config.allowedEmails.length && !config.allowedEmails.includes(email)) return fail('not_allowed');
  let u = await one<{ id: string }>('select id from users where google_sub = $1', [info.sub]);
  if (!u) {
    u = await one<{ id: string }>('update users set google_sub = $2 where email = $1 returning id', [email, info.sub]);
    if (!u) u = await one<{ id: string }>('insert into users (email, name, google_sub) values ($1,$2,$3) returning id', [email, info.name || email, info.sub]);
  }
  await ensureSettings(u!.id);
  await createSession(u!.id);
  return NextResponse.redirect(`${config.appUrl}/`);
}
