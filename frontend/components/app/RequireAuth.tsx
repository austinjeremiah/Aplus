'use client';

/**
 * Gate for the application routes.
 *
 * /verify is deliberately NOT behind this — the whole point of the provenance
 * page is that a third party can check an asset without an account.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth';

const PUBLIC = ['/verify'];

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const isPublic = PUBLIC.some((p) => path.startsWith(p));

  useEffect(() => {
    if (ready && !user && !isPublic) router.replace('/');
  }, [ready, user, isPublic, router]);

  // Nothing is rendered until the stored session has been read, otherwise the
  // page flashes its signed-in state for a frame before redirecting.
  if (!ready) return null;
  if (!user && !isPublic) return null;

  return <>{children}</>;
}
