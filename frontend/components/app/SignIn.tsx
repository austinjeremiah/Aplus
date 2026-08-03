'use client';

/**
 * The "Sign in with Google" control on the landing hero.
 *
 * Renders Google's own button when a client ID is configured. When one is not
 * — a fresh clone, or a deploy where the env var hasn't been set — it falls
 * back to a plain continue button rather than a dead end, so the app is never
 * unreachable because of a missing credential. The fallback says what it is.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GOOGLE_CLIENT_ID, decodeCredential, useAuth } from './auth';

declare global {
  interface Window {
    google?: any;
  }
}

export default function SignIn() {
  const { user, signIn } = useAuth();
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || user) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onerror = () => setFailed(true);
    script.onload = () => {
      try {
        window.google?.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (res: { credential: string }) => {
            const u = decodeCredential(res.credential);
            if (u) {
              signIn(u);
              router.push('/dashboard');
            } else {
              setFailed(true);
            }
          },
        });
        if (holder.current) {
          window.google?.accounts.id.renderButton(holder.current, {
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            text: 'signin_with',
            width: 260,
          });
        }
      } catch {
        setFailed(true);
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [user, signIn, router]);

  if (user) return null;

  const configured = Boolean(GOOGLE_CLIENT_ID) && !failed;

  return (
    <div className="app_signin">
      {configured ? <div ref={holder} /> : null}

      {!configured ? (
        <>
          <button
            onClick={() => {
              signIn({ name: 'Guest', email: 'guest@aplusplus.local' });
              router.push('/dashboard');
            }}
            data-btn-default=""
            className="g_btn_main w-inline-block"
          >
            <div className="g_btn_text_contain">
              <div className="g_btn_text u-text-style-small u-text-trim-off">Enter the app</div>
            </div>
            <div className="g_btn_aside_wrap">
              <div className="g_btn_aside_bg" />
              <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z"
                  fill="currentColor"
                />
              </svg>
            </div>
          </button>
          <span className="u-text-mono u-text-style-xsmall app_signin_note">
            {failed
              ? 'GOOGLE SIGN-IN UNAVAILABLE — CONTINUING AS GUEST'
              : 'SET NEXT_PUBLIC_GOOGLE_CLIENT_ID TO ENABLE GOOGLE SIGN-IN'}
          </span>
        </>
      ) : null}
    </div>
  );
}
