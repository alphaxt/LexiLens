import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { updatePrivacyPreferencesSchema } from '@lexilens/contracts';
import { AccountService } from './account.service';
import { type AuthPrincipal, CurrentPrincipal, IdentityGuard } from './auth/identity';
import { RequireScope, RequireScopeGuard } from './auth/require-scope.guard';

@ApiTags('account')
@ApiBearerAuth('oidc')
@ApiHeader({
  name: 'x-local-session-id',
  required: false,
  description: 'Development/test-only local session UUID.',
})
@UseGuards(IdentityGuard, RequireScopeGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}
  @Get() @RequireScope('account:read') async get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accounts.get(principal);
  }
  @Patch('privacy') @RequireScope('account:write') async updatePrivacy(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: unknown,
  ) {
    const parsed = updatePrivacyPreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.accounts.update(principal, parsed.data);
  }
  @Get('export') @RequireScope('account:read') async export(
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.accounts.export(principal);
  }
  @Get('audit-log') @RequireScope('account:read') async auditLog(
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.accounts.auditLog(principal);
  }
  @Delete() @RequireScope('account:delete') async delete(
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.accounts.delete(principal);
  }
}
