'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'Dashboard'],
  ['/meetings', 'Meetings'],
  ['/actions', 'Action Items'],
  ['/search', 'Search'],
  ['/settings', 'Settings'],
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
