'use client';

/**
 * Session state for the app.
 *
 * The Google credential is a signed JWT; we decode the profile out of it and
 * keep it in localStorage. This gates the UI — the API stays unauthenticated
 * on purpose so the public /verify page keeps working for third parties.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface User {
  name: string;
  email: string;
  picture?: string;
}

const KEY = 'aplus.user';

const Ctx = createContext<{
  user: User | null;
  ready: boolean;
  signIn: (u: User) => void;
  signOut: () => void;
}>({ user: null, ready: false, signIn: () => {}, signOut: () => {} });

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

export const useAuth = () => useContext(Ctx);

/** Decode the profile from a Google ID token (JWT payload is base64url). */
export function decodeCredential(jwt: string): User | null {
  try {
    const p = JSON.parse(
      decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))),
    );
    return p.email ? { name: p.name ?? p.email, email: p.email, picture: p.picture } : null;
  } catch {
    return null;
  }
}
