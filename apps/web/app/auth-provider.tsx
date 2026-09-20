'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { oidcCallbackErrorMessage } from '../lib/auth-callback';
import { publicAuthConfig } from '../lib/auth-config';
import { createAuthenticatedFetch, type AuthenticatedFetch } from '../lib/auth-transport';
import { getOidcManager, safeIdentity } from '../lib/oidc';

type AuthContextValue = {
  ready: boolean;
  isAuthenticated: boolean;
  identity: string | null;
  error: string | null;
  authenticatedFetch: AuthenticatedFetch;
  login: () => Promise<void>;
  completeLogin: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [localSession, setLocalSession] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearOidcSession = useCallback(() => {
    setAccessToken(null);
    setIdentity(null);
  }, []);

  useEffect(() => {
    if (publicAuthConfig.mode === 'local') {
      const stored = window.localStorage.getItem('lexilens-local-session');
      const session = stored ?? window.crypto.randomUUID();
      window.localStorage.setItem('lexilens-local-session', session);
      setLocalSession(session);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (publicAuthConfig.mode !== 'oidc') return;
    const manager = getOidcManager();
    manager.events.addAccessTokenExpired(clearOidcSession);
    return () => manager.events.removeAccessTokenExpired(clearOidcSession);
  }, [clearOidcSession]);

  const login = useCallback(async () => {
    setError(null);
    try {
      await getOidcManager().signinRedirect();
    } catch {
      setError('Sign-in could not be started. Please try again.');
    }
  }, []);

  const completeLogin = useCallback(async () => {
    try {
      const user = await getOidcManager().signinRedirectCallback();
      if (user.expired || !user.access_token) throw new Error('expired');
      setAccessToken(user.access_token);
      setIdentity(safeIdentity(user));
      setError(null);
    } catch (caught) {
      clearOidcSession();
      setError(oidcCallbackErrorMessage(caught));
      throw new Error('OIDC callback failed.');
    }
  }, [clearOidcSession]);

  const logout = useCallback(async () => {
    clearOidcSession();
    if (publicAuthConfig.mode === 'local') {
      window.localStorage.removeItem('lexilens-local-session');
      setLocalSession(null);
      return;
    }
    try {
      await getOidcManager().signoutRedirect();
    } catch {
      setError(
        'You were signed out locally. The identity provider sign-out could not be completed.',
      );
    }
  }, [clearOidcSession]);

  const authenticatedFetch = useMemo(
    () =>
      createAuthenticatedFetch(
        () => (publicAuthConfig.mode === 'local' ? localSession : accessToken),
        clearOidcSession,
      ),
    [accessToken, clearOidcSession, localSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      isAuthenticated:
        publicAuthConfig.mode === 'local' ? Boolean(localSession) : Boolean(accessToken),
      identity,
      error,
      authenticatedFetch,
      login,
      completeLogin,
      logout,
    }),
    [
      accessToken,
      authenticatedFetch,
      completeLogin,
      error,
      identity,
      localSession,
      login,
      logout,
      ready,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
