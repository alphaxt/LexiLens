import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { GetPublicKeyOrSecret, JwtPayload } from 'jsonwebtoken';
import jsonwebtoken from 'jsonwebtoken';
import jwksClient, { type JwksClient } from 'jwks-rsa';
import { loadConfig } from '../config';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthPrincipal = {
  ownerId: string;
  subject: string;
  mode: 'local' | 'oidc';
  scopes: string[];
};

type AuthenticatedRequest = {
  headers: IncomingHttpHeaders;
  principal?: AuthPrincipal;
};

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function ownerIdForOidcSubject(issuer: string, subject: string): string {
  return `oidc:${createHash('sha256').update(`${issuer}|${subject}`).digest('hex')}`;
}

@Injectable()
export class IdentityService {
  private readonly config = loadConfig();
  private readonly jwks: JwksClient | null;

  constructor() {
    const jwksUri = this.config.OIDC_JWKS_URI;
    this.jwks = jwksUri
      ? jwksClient({
          jwksUri,
          cache: true,
          cacheMaxEntries: 5,
          cacheMaxAge: 10 * 60 * 1000,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
          timeout: 10_000,
        })
      : null;
  }

  async authenticate(headers: IncomingHttpHeaders): Promise<AuthPrincipal> {
    if (this.config.AUTH_MODE === 'local') return this.authenticateLocal(headers);
    return this.authenticateOidc(headers);
  }

  private authenticateLocal(headers: IncomingHttpHeaders): AuthPrincipal {
    const sessionId = singleHeader(headers['x-local-session-id']);
    if (!sessionId || !UUID_V4.test(sessionId)) {
      throw new UnauthorizedException('A valid local session identity is required.');
    }
    return { ownerId: `local:${sessionId}`, subject: sessionId, mode: 'local', scopes: [] };
  }

  private async authenticateOidc(headers: IncomingHttpHeaders): Promise<AuthPrincipal> {
    const authorization = singleHeader(headers.authorization);
    const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('A bearer access token is required.');

    const issuer = this.config.OIDC_ISSUER_URL;
    const audience = this.config.OIDC_AUDIENCE;
    const jwksUri = this.config.OIDC_JWKS_URI;
    if (!issuer || !audience || !jwksUri || !this.jwks) {
      throw new UnauthorizedException('OIDC authentication is not configured.');
    }

    const signingKey: GetPublicKeyOrSecret = (header, callback) => {
      if (!header.kid) {
        callback(new Error('The access token does not identify a signing key.'));
        return;
      }
      this.jwks!.getSigningKey(header.kid)
        .then((key) => callback(null, key.getPublicKey()))
        .catch((error: unknown) =>
          callback(error instanceof Error ? error : new Error('JWKS lookup failed.')),
        );
    };

    const claims = await new Promise<JwtPayload>((resolve, reject) => {
      jsonwebtoken.verify(
        token,
        signingKey,
        { algorithms: ['RS256'], audience, issuer },
        (error, decoded) => {
          if (error || !decoded || typeof decoded === 'string') {
            reject(new UnauthorizedException('The access token is invalid or expired.'));
            return;
          }
          resolve(decoded);
        },
      );
    });

    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
      throw new UnauthorizedException('The access token requires a numeric expiration claim.');
    }
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
      throw new UnauthorizedException('The access token requires a non-empty string subject.');
    }
    const tokenIssuer = typeof claims.iss === 'string' ? claims.iss : issuer;
    return {
      ownerId: ownerIdForOidcSubject(tokenIssuer, claims.sub),
      subject: claims.sub,
      mode: 'oidc',
      scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [],
    };
  }
}

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly identities: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = await this.identities.authenticate(request.headers);
    return true;
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedException('No authenticated principal found.');
    return request.principal;
  },
);
