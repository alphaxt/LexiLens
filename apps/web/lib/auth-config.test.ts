import { describe, expect, it } from 'vitest';
import { loadPublicAuthConfig } from './auth-config';

const oidc = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_AUTH_MODE: 'oidc',
  NEXT_PUBLIC_API_URL: 'https://api.lexilens.example',
  NEXT_PUBLIC_OIDC_ISSUER: 'https://issuer.example',
  NEXT_PUBLIC_OIDC_CLIENT_ID: 'public-spa',
  NEXT_PUBLIC_OIDC_REDIRECT_URI: 'https://app.lexilens.example/auth/callback',
  NEXT_PUBLIC_OIDC_POST_LOGOUT_URI: 'https://app.lexilens.example/',
  NEXT_PUBLIC_OIDC_AUDIENCE: 'https://api.lexilens.example',
  NEXT_PUBLIC_OIDC_SCOPE: 'openid profile documents:read',
};

describe('public auth config', () => {
  it('rejects local mode in production', () =>
    expect(() => loadPublicAuthConfig({ NODE_ENV: 'production' })).toThrow('Production'));
  it('rejects incomplete OIDC configuration and refresh-token scope', () => {
    expect(() =>
      loadPublicAuthConfig({ NODE_ENV: 'production', NEXT_PUBLIC_AUTH_MODE: 'oidc' }),
    ).toThrow('required');
    expect(() =>
      loadPublicAuthConfig({ ...oidc, NEXT_PUBLIC_OIDC_SCOPE: 'openid offline_access' }),
    ).toThrow('offline_access');
  });
  it('accepts a complete public OIDC configuration', () =>
    expect(loadPublicAuthConfig(oidc).clientId).toBe('public-spa'));
});
