import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthPrincipal } from './identity';

export const REQUIRED_SCOPE = 'lexilens:required-scope';
export type ApiScope =
  | 'documents:read'
  | 'documents:write'
  | 'account:read'
  | 'account:write'
  | 'account:delete';
/** Declares the least-privilege OAuth scope required by an API route. */
export const RequireScope = (scope: ApiScope) => SetMetadata(REQUIRED_SCOPE, scope);

@Injectable()
export class RequireScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scope = this.reflector.getAllAndOverride<ApiScope>(REQUIRED_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;
    const principal = context.switchToHttp().getRequest<{ principal?: AuthPrincipal }>().principal;
    if (!principal) return false;
    // Local identity is a loopback-only development/test configuration validated by loadConfig.
    if (principal.mode === 'local') return true;
    if (principal.scopes.includes(scope)) return true;
    throw new ForbiddenException(`The ${scope} scope is required.`);
  }
}
