import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { type AuthPrincipal } from './identity';

@Injectable()
export class RequireScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ principal?: AuthPrincipal }>();
    const principal = request.principal;
    if (!principal) return false;
    if (principal.mode === 'local' || principal.scopes.includes('documents:write')) return true;
    throw new ForbiddenException('The documents:write scope is required.');
  }
}
