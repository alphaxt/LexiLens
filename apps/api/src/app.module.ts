import { Module } from '@nestjs/common';
import { IdentityGuard, IdentityService } from './auth/identity';
import { DocumentsController, HealthController } from './documents.controller';
import { DocumentService } from './documents.service';

@Module({
  controllers: [HealthController, DocumentsController],
  providers: [DocumentService, IdentityService, IdentityGuard],
})
export class AppModule {}
