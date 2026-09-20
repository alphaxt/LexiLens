import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { UnauthorizedException } from '@nestjs/common';
import jsonwebtoken from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityService, ownerIdForOidcSubject } from './identity';

const originalEnvironment = { ...process.env };
const sessionId = '9f7cc982-50e7-4f2b-8ff5-b5100cc0bf09';
const issuer = 'http://127.0.0.1:18991/';
const audience = 'https://api.lexilens.example';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
};
let server: Server;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => server.listen(18991, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  process.env = { ...originalEnvironment, NODE_ENV: 'test' };
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

function configureOidc(): void {
  process.env.AUTH_MODE = 'oidc';
  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_JWKS_URI = `${issuer}oauth/custom-keys`;
  process.env.OIDC_AUDIENCE = audience;
}

function signToken(
  payload: Record<string, unknown>,
  options: jsonwebtoken.SignOptions = {},
): string {
  return jsonwebtoken.sign(payload, privateKey, {
    algorithm: 'RS256',
    keyid: 'test-key',
    issuer,
    audience,
    ...options,
  });
}

describe('IdentityService', () => {
  it('maps a valid development session to a namespaced principal', async () => {
    process.env.AUTH_MODE = 'local';
    const principal = await new IdentityService().authenticate({ 'x-local-session-id': sessionId });
    expect(principal).toEqual({
      ownerId: `local:${sessionId}`,
      subject: sessionId,
      mode: 'local',
      scopes: [],
    });
  });

  it('rejects caller-controlled non-UUID local identities', async () => {
    process.env.AUTH_MODE = 'local';
    await expect(
      new IdentityService().authenticate({ 'x-local-session-id': 'shared-user' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifies an RS256 token through an explicit non-standard JWKS URI', async () => {
    configureOidc();
    const token = signToken(
      { scope: 'documents:read documents:write' },
      { subject: 'user-123', expiresIn: 300 },
    );
    const principal = await new IdentityService().authenticate({
      authorization: `Bearer ${token}`,
    });
    expect(principal.subject).toBe('user-123');
    expect(principal.scopes).toEqual(['documents:read', 'documents:write']);
    expect(principal.ownerId).toBe(ownerIdForOidcSubject(issuer, 'user-123'));
  });

  it('rejects signed tokens with missing expiration or malformed subjects', async () => {
    configureOidc();
    const withoutExpiration = signToken({ sub: 'user-123' });
    const numericSubject = signToken({ sub: 123 }, { expiresIn: 300 });
    await expect(
      new IdentityService().authenticate({ authorization: `Bearer ${withoutExpiration}` }),
    ).rejects.toThrow('numeric expiration');
    await expect(
      new IdentityService().authenticate({ authorization: `Bearer ${numericSubject}` }),
    ).rejects.toThrow('non-empty string subject');
  });

  it('rejects expired tokens and incorrect audiences', async () => {
    configureOidc();
    const expired = signToken({}, { subject: 'user-123', expiresIn: -1 });
    const wrongAudience = signToken(
      {},
      { subject: 'user-123', expiresIn: 300, audience: 'https://other.example' },
    );
    await expect(
      new IdentityService().authenticate({ authorization: `Bearer ${expired}` }),
    ).rejects.toThrow('invalid or expired');
    await expect(
      new IdentityService().authenticate({ authorization: `Bearer ${wrongAudience}` }),
    ).rejects.toThrow('invalid or expired');
  });

  it('requires bearer credentials in OIDC mode before any JWKS request', async () => {
    configureOidc();
    await expect(new IdentityService().authenticate({})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('derives stable, issuer-separated internal owner identifiers', () => {
    expect(ownerIdForOidcSubject('https://one.example/', 'user-1')).toBe(
      ownerIdForOidcSubject('https://one.example/', 'user-1'),
    );
    expect(ownerIdForOidcSubject('https://one.example/', 'user-1')).not.toBe(
      ownerIdForOidcSubject('https://two.example/', 'user-1'),
    );
  });
});
