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
import { MagicDocumentScannerAdapter } from './scanner/magic-document-scanner.adapter';
import { DOCUMENT_SCANNER_PORT } from './scanner/document-scanner.port';
import { MemoryQuarantineStorageAdapter } from './storage/memory-quarantine-storage.adapter';
import { QUARANTINE_STORAGE_PORT } from './storage/quarantine-storage.port';
import { S3QuarantineStorageAdapter } from './storage/s3-quarantine-storage.adapter';
import { ExtractionService } from './extraction.service';
import { UploadService } from './uploads.service';

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
    {
      provide: QUARANTINE_STORAGE_PORT,
      useFactory: () =>
        config.STORAGE_MODE === 's3'
          ? new S3QuarantineStorageAdapter(
              config.S3_ENDPOINT!,
              config.S3_BUCKET!,
              config.S3_REGION,
              config.S3_ACCESS_KEY_ID!,
              config.S3_SECRET_ACCESS_KEY!,
            )
          : new MemoryQuarantineStorageAdapter(),
    },
    { provide: DOCUMENT_SCANNER_PORT, useClass: MagicDocumentScannerAdapter },
    DocumentService,
    UploadService,
    ExtractionService,
    AccountService,
    IdentityService,
    IdentityGuard,
  ],
})
export class AppModule {}
