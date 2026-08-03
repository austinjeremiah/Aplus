'use client';

/** App navigation. Reuses the template's navbar classes and type styles. */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/generate', label: 'Generate' },
  { href: '/review', label: 'Review' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/verify', label: 'Verify' },
];

export default function AppNav() {
  const path = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  return (
    <header className="app_nav">
      <div className="app_nav_contain app_container">
        <div>
          <Link href="/" aria-label="A++ home">
            <span className="u-text-style-h5 u-text-trim-off">A++</span>
          </Link>
        </div>
        <nav className="u-text-style-small u-text-trim-off">
          <ul className="app_nav_ul">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(`${l.href}/`);
              return (
                <li key={l.href}>
                  <Link href={l.href} className="app_nav_link">
                    <span className="u-text-style-main" style={{ opacity: active ? 1 : 0.45 }}>
                      {l.label}
                    </span>
                  </Link>
                </li>
              );
            })}
            {user ? (
              <li className="app_nav_user">
                {user.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.picture} alt="" className="app_nav_avatar" referrerPolicy="no-referrer" />
                ) : null}
                <button
                  onClick={() => {
                    signOut();
                    router.replace('/');
                  }}
                  className="app_nav_link"
                  title={user.email}
                >
                  <span className="u-text-style-main" style={{ opacity: 0.45 }}>
                    Sign out
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>
    </header>
  );
}
