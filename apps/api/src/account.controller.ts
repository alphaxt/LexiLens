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

@ApiTags('account')
@ApiBearerAuth('oidc')
@ApiHeader({
  name: 'x-local-session-id',
  required: false,
  description: 'Development-only local session UUID.',
})
@UseGuards(IdentityGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accounts.get(principal);
  }

  @Patch('privacy')
  updatePrivacy(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = updatePrivacyPreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.accounts.update(principal, parsed.data);
  }

  @Get('export')
  export(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accounts.export(principal);
  }

  @Get('audit-log')
  auditLog(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accounts.auditLog(principal);
  }

  @Delete()
  delete(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.accounts.delete(principal);
  }
}
