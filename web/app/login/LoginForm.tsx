'use client';
import { useState } from 'react';

export default function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fd)) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.issues?.[0]?.message ? `${body.issues[0].path?.join('.')}: ${body.issues[0].message}` : body.error || 'Failed');
    location.href = next && next.startsWith('/') ? next : '/';
  }
  return (
    <form onSubmit={submit}>
      {mode === 'register' && (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" required autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
      </div>
      {error && <div className="alert err" style={{ marginBottom: 12 }}>{error}</div>}
      <button className="btn primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {mode === 'login' ? 'No account?' : 'Already registered?'}{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), setMode(mode === 'login' ? 'register' : 'login'))}>
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </a>
      </p>
    </form>
  );
}
