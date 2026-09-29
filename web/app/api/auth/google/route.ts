import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { randomToken, signState } from '@/lib/auth';

export async function GET() {
  if (!config.googleClientId) return NextResponse.redirect(`${config.appUrl}/login?error=google_not_configured`);
  const state = signState(`${randomToken(12)}:${Date.now()}`);
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.appUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set('mt_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 600 });
  return res;
}
