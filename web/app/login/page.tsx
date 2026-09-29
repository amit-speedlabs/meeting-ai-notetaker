import LoginForm from './LoginForm';

const ERRORS: Record<string, string> = {
  google_not_configured: 'Google Sign-In is not configured on this server (GOOGLE_CLIENT_ID is missing). Use email and password.',
  oauth_state: 'Google sign-in could not be verified. Please try again.',
  oauth_token: 'Google sign-in failed. Please try again.',
  oauth_userinfo: 'Could not read your Google profile.',
  email_unverified: 'Your Google email address is not verified.',
  not_allowed: 'This server only allows invited email addresses.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="panel" style={{ width: 'min(420px, 100%)' }}>
        <h1 style={{ marginBottom: 4 }}>Meeting AI Notetaker</h1>
        <p className="muted" style={{ marginTop: 0 }}>Start meeting → listen → transcribe → take notes → extract actions → search later.</p>
        {sp.error && <div className="alert err" style={{ marginBottom: 12 }}>{ERRORS[sp.error] || 'Sign-in failed.'}</div>}
        <a className="btn" href="/api/auth/google" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}>
          Continue with Google
        </a>
        <div className="muted small" style={{ textAlign: 'center', marginBottom: 14 }}>or use email</div>
        <LoginForm next={sp.next} />
      </div>
    </div>
  );
}
