'use client';
export default function LogoutButton() {
  return (
    <button
      className="btn ghost sm"
      style={{ padding: '4px 0' }}
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}
