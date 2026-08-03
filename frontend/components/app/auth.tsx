'use client';

/**
 * Google sign-in.
 *
 * Uses Google Identity Services directly rather than NextAuth: GIS needs only
 * a public client ID (no secret, no callback route, no session backend), which
 * keeps the deploy story to a single env var and avoids an OAuth redirect URL
 * that breaks the moment the hosting domain changes.
 *
 * The credential is a signed JWT. We decode it for the profile and keep it in
 * localStorage. That is a *demo gate*, not a security boundary — the API is
 * unauthenticated by design so the verify page stays public — and it is
 * labelled as such rather than implying protection it does not provide.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface User {
  name: string;
  email: string;
  picture?: string;
}

const KEY = 'aplusplus.user';

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn: (u: User) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthState>({
  user: null,
  ready: false,
  signIn: () => {},
  signOut: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* corrupt entry — treat as signed out */
    }
    setReady(true);
  }, []);

  const signIn = useCallback((u: User) => {
    localStorage.setItem(KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(KEY);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

/** Decode the profile out of a Google ID token (JWT payload, base64url). */
export function decodeCredential(jwt: string): User | null {
  try {
    const payload = jwt.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const d = JSON.parse(decodeURIComponent(escape(json)));
    if (!d.email) return null;
    return { name: d.name ?? d.email, email: d.email, picture: d.picture };
  } catch {
    return null;
  }
}

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
