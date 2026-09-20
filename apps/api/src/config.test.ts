import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const productionOidc = {
  NODE_ENV: 'production',
  AUTH_MODE: 'oidc',
  OIDC_ISSUER_URL: 'https://tenant.example.com/',
  OIDC_JWKS_URI: 'https://keys.example.com/oauth/jwks',
  OIDC_AUDIENCE: 'https://api.lexilens.example',
  PERSISTENCE_MODE: 'postgresql',
  DATABASE_URL: 'postgresql://lexilens:secret@database.internal:5432/lexilens?schema=public',
  STORAGE_MODE: 's3',
  S3_ENDPOINT: 'https://storage.example.com',
  S3_BUCKET: 'lexilens-private',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  SCANNER_MODE: 'configured',
  SCANNER_ENDPOINT: 'https://scanner.example.com/scan',
  SCANNER_VERSION: 'reviewed-v1',
} as const;

describe('runtime configuration', () => {
  it('defaults local and test environments to in-memory persistence', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      AUTH_MODE: 'local',
      PERSISTENCE_MODE: 'memory',
    });
  });

  it('prohibits local session mode and memory persistence in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'local',
        PERSISTENCE_MODE: 'memory',
      }),
    ).toThrow('Production requires AUTH_MODE=oidc');
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'oidc',
        OIDC_ISSUER_URL: productionOidc.OIDC_ISSUER_URL,
        OIDC_JWKS_URI: productionOidc.OIDC_JWKS_URI,
        OIDC_AUDIENCE: productionOidc.OIDC_AUDIENCE,
      }),
    ).toThrow('Production requires PERSISTENCE_MODE=postgresql');
  });

  it('requires a PostgreSQL URL whenever PostgreSQL persistence is selected', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', PERSISTENCE_MODE: 'postgresql' })).toThrow(
      'DATABASE_URL is required',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        PERSISTENCE_MODE: 'postgresql',
        DATABASE_URL: 'https://database.example.com/lexilens',
      }),
    ).toThrow('must use the postgresql:// or postgres:// protocol');
  });

  it('requires local mode to bind only to loopback', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'local', HOST: '0.0.0.0' }),
    ).toThrow('Local authentication mode is only permitted');
  });

  it('requires issuer, explicit JWKS URI, and audience in OIDC mode', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'oidc' })).toThrow(
      'OIDC_ISSUER_URL is required',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
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

  it('rejects magic scanner selection in production and requires configured scanner details', () => {
    expect(() => loadConfig({ ...productionOidc, SCANNER_MODE: 'magic' })).toThrow(
      'SCANNER_MODE=configured',
    );
    expect(() => loadConfig({ NODE_ENV: 'test', SCANNER_MODE: 'configured' })).toThrow(
      'SCANNER_ENDPOINT is required',
    );
    expect(() =>
      loadConfig({ ...productionOidc, SCANNER_ENDPOINT: 'http://scanner.example.com/scan' }),
    ).toThrow('scanner endpoint must use HTTPS');
  });

  it('accepts complete production OIDC, PostgreSQL, and configured scanner configuration', () => {
    expect(loadConfig(productionOidc)).toMatchObject({
      AUTH_MODE: 'oidc',
      PERSISTENCE_MODE: 'postgresql',
      SCANNER_MODE: 'configured',
    });
  });
});

describe('OCR provider configuration boundary', () => {
  it('keeps OCR disabled by default', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).OCR_MODE).toBe('disabled');
  });

  it('fails closed when an enabled provider selection is incomplete', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', OCR_MODE: 'configured' })).toThrow(
      'OCR_PROVIDER_ENDPOINT is required',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        OCR_MODE: 'configured',
        OCR_PROVIDER_ENDPOINT: 'https://ocr.example.test/extract',
      }),
    ).toThrow('OCR_PROVIDER_CREDENTIAL is required');
  });

  it('requires HTTPS for configured production OCR endpoints', () => {
    expect(() =>
      loadConfig({
        ...productionOidc,
        OCR_MODE: 'configured',
        OCR_PROVIDER_ENDPOINT: 'http://ocr.example.test/extract',
        OCR_PROVIDER_CREDENTIAL: 'deployment-secret',
      }),
    ).toThrow('OCR provider endpoint must use HTTPS');
  });
});
