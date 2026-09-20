import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { IdentityGuard, IdentityService } from './auth/identity';
import { RequireScopeGuard } from './auth/require-scope.guard';
import { loadConfig } from './config';
import { DocumentsController, HealthController } from './documents.controller';
import { DocumentService } from './documents.service';
import { DisabledOcrProviderAdapter } from './extraction/disabled-ocr-provider.adapter';
import { LocalNativeDocumentExtractorAdapter } from './extraction/local-native-document-extractor.adapter';
import { NATIVE_DOCUMENT_EXTRACTOR_PORT } from './extraction/native-document-extractor.port';
import { OCR_PROVIDER_PORT } from './extraction/ocr-provider.port';
import { ExtractionService } from './extraction.service';
import { ExtractionWorkerService } from './extraction-worker.service';
import { CleanupReconcilerService } from './cleanup-reconciler.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';
import { PERSISTENCE_PORT } from './persistence/persistence.port';
import { PrismaPersistenceAdapter } from './persistence/prisma-persistence.adapter';
import { ConfiguredDocumentScannerAdapter } from './scanner/configured-document-scanner.adapter';
import { DOCUMENT_SCANNER_PORT } from './scanner/document-scanner.port';
import { MagicDocumentScannerAdapter } from './scanner/magic-document-scanner.adapter';
import { MemoryQuarantineStorageAdapter } from './storage/memory-quarantine-storage.adapter';
import { QUARANTINE_STORAGE_PORT } from './storage/quarantine-storage.port';
import { S3QuarantineStorageAdapter } from './storage/s3-quarantine-storage.adapter';
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
              config.S3_ACCESS_KEY_ID,
              config.S3_SECRET_ACCESS_KEY,
            )
          : new MemoryQuarantineStorageAdapter(),
    },
    {
      provide: DOCUMENT_SCANNER_PORT,
      useClass:
        config.SCANNER_MODE === 'configured'
          ? ConfiguredDocumentScannerAdapter
          : MagicDocumentScannerAdapter,
    },
    { provide: NATIVE_DOCUMENT_EXTRACTOR_PORT, useClass: LocalNativeDocumentExtractorAdapter },
    { provide: OCR_PROVIDER_PORT, useClass: DisabledOcrProviderAdapter },
    DocumentService,
    UploadService,
    ExtractionService,
    ExtractionWorkerService,
    CleanupReconcilerService,
    AccountService,
    IdentityService,
    IdentityGuard,
    RequireScopeGuard,
  ],
})
export class AppModule {}
