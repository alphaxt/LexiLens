import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { IdentityGuard, IdentityService } from './auth/identity';
import { DocumentsController, HealthController } from './documents.controller';
import { DocumentService } from './documents.service';

@Module({
  controllers: [HealthController, DocumentsController, AccountController],
  providers: [DocumentService, AccountService, IdentityService, IdentityGuard],
})
export class AppModule {}
