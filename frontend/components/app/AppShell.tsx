'use client';

/**
 * Shell for every signed-in page: nav, auth gate, container.
 *
 * The nav itself lives in AppNav because the public verify page needs the same
 * bar; what belongs here is the gate that bounces signed-out visitors.
 */

import '@/app/app.css';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppNav from '@/components/app/AppNav';
import { useAuth } from '@/components/auth/AuthProvider';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace('/');
  }, [ready, user, router]);

  // Render nothing until the stored session has been read, so the page doesn't
  // flash its signed-in state for a frame before bouncing.
  if (!ready || !user) return null;

  return (
    <div className="page_wrap">
      <AppNav />
      <main className="app_main">
        <div className="app_container">{children}</div>
      </main>
    </div>
  );
}
