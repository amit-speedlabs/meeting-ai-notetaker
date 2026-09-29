import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, User } from '@/lib/auth';
import LogoutButton from './LogoutButton';
import NavLinks from './NavLinks';

/** Authenticated page wrapper. Returns the user to the page via the render prop. */
export default async function AppShell({ children }: { children: (user: User) => React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="dot" /> Meeting AI
        </Link>
        <NavLinks />
        <div className="foot">
          <div>{user.name}</div>
          <div className="small">{user.email}</div>
          <LogoutButton />
          <div style={{ marginTop: 8 }}>
            <Link href="/privacy">Privacy &amp; data</Link>
          </div>
        </div>
      </aside>
      <main>{children(user)}</main>
    </div>
  );
}
