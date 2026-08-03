'use client';

/**
 * Google sign-in, pinned top-right of the landing.
 *
 * Uses Google Identity Services directly rather than NextAuth: GIS needs only
 * a public client ID — no secret, no callback route, no session backend —
 * which keeps deployment to one env var and avoids an OAuth redirect URL that
 * breaks the moment the hosting domain changes.
 *
 * Signing in does NOT auto-redirect. An effect that pushed to /dashboard on
 * any mount made the landing unreachable once a session existed: every visit
 * to "/" bounced straight back out, with no way to return or sign out. The
 * signed-in state is shown here instead, with both actions available.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { decodeCredential, useAuth } from './AuthProvider';

declare global {
  interface Window {
    google?: any;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

function Arrow() {
  return (
    <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Btn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} data-btn-default="" className="g_btn_main w-inline-block">
      <div className="g_btn_text_contain">
        <div className="g_btn_text u-text-style-small u-text-trim-off">{label}</div>
      </div>
      <div className="g_btn_aside_wrap">
        <div className="g_btn_aside_bg" />
        <Arrow />
      </div>
    </button>
  );
}

export default function GoogleLogin() {
  const { user, ready, signIn, signOut } = useAuth();
  const router = useRouter();
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID || user || !ready) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onerror = () => setFailed(true);
    s.onload = () => {
      try {
        window.google?.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: ({ credential }: { credential: string }) => {
            const u = decodeCredential(credential);
            if (!u) return setFailed(true);
            signIn(u);
            router.push('/dashboard');
          },
        });
        if (slot.current) {
          window.google?.accounts.id.renderButton(slot.current, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            text: 'signin_with',
            width: 220,
          });
        }
      } catch {
        setFailed(true);
      }
    };
    document.body.appendChild(s);
    return () => s.remove();
  }, [user, ready, signIn, router]);

  // Nothing until the stored session has been read, so the signed-out state
  // doesn't flash for a frame on every load.
  if (!ready) return null;

  return (
    <div style={{ position: 'fixed', top: '1.75rem', right: '2rem', zIndex: 100 }}>
      {user ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55 }}>
            {user.email}
          </span>
          <button
            onClick={signOut}
            className="u-text-style-small"
            style={{ opacity: 0.55, textDecoration: 'underline' }}
          >
            Sign out
          </button>
          <Btn onClick={() => router.push('/dashboard')} label="Enter the app" />
        </div>
      ) : CLIENT_ID && !failed ? (
        <div ref={slot} />
      ) : (
        <Btn
          onClick={() => {
            signIn({ name: 'Guest', email: 'guest@aplusfoundry.local' });
            router.push('/dashboard');
          }}
          label="Continue to the app"
        />
      )}
    </div>
  );
}
