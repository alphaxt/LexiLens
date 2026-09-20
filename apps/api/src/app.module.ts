import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { IdentityGuard, IdentityService } from './auth/identity';
import { loadConfig } from './config';
import { DocumentsController, HealthController } from './documents.controller';
import { DocumentService } from './documents.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';
import { PERSISTENCE_PORT } from './persistence/persistence.port';
import { PrismaPersistenceAdapter } from './persistence/prisma-persistence.adapter';

const config = loadConfig();

@Module({
  controllers: [HealthController, DocumentsController, AccountController],
  providers: [
    {
      provide: PERSISTENCE_PORT,
      useFactory: () =>
        config.PERSISTENCE_MODE === 'postgresql'
          ? new PrismaPersistenceAdapter(config.DATABASE_URL!)
          : new MemoryPersistenceAdapter(),
    },
    DocumentService,
    AccountService,
    IdentityService,
    IdentityGuard,
  ],
})
export class AppModule {}
