import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const productionOidc = {
  NODE_ENV: 'production',
  AUTH_MODE: 'oidc',
  OIDC_ISSUER_URL: 'https://tenant.example.com/',
  OIDC_JWKS_URI: 'https://keys.example.com/oauth/jwks',
  OIDC_AUDIENCE: 'https://api.lexilens.example',
} as const;

describe('authentication configuration', () => {
  it('prohibits local session mode in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'local' })).toThrow(
      'Production requires AUTH_MODE=oidc',
    );
  });

  it('requires local mode to bind only to loopback', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'local', HOST: '0.0.0.0' }),
    ).toThrow('Local authentication mode requires a loopback HOST');
  });

  it('requires issuer, explicit JWKS URI, and audience in OIDC mode', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'oidc' })).toThrow(
      'OIDC_ISSUER_URL is required',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'oidc',
        OIDC_ISSUER_URL: 'https://tenant.example.com/',
        OIDC_AUDIENCE: 'api',
      }),
    ).toThrow('OIDC_JWKS_URI is required');
  });

  it('requires HTTPS provider endpoints in production', () => {
    expect(() =>
      loadConfig({ ...productionOidc, OIDC_ISSUER_URL: 'http://tenant.example.com/' }),
    ).toThrow('issuer must use HTTPS');
    expect(() =>
      loadConfig({ ...productionOidc, OIDC_JWKS_URI: 'http://keys.example.com/jwks' }),
    ).toThrow('JWKS URI must use HTTPS');
  });

  it('accepts complete production OIDC configuration', () => {
    expect(loadConfig(productionOidc).AUTH_MODE).toBe('oidc');
  });
});
