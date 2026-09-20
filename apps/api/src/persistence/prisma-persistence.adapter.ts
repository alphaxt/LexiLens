import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  auditSchema,
  extractionArtifactSchema,
  extractionFailureSchema,
  type Account,
  type Audit,
  type DocumentRecord,
  type ProcessingStatus,
  type SecurityEvent,
  type UpdatePrivacyPreferences,
} from '@lexilens/contracts';
import {
  DATABASE_SCHEMA_VERSION,
  Prisma,
  PrismaClient,
  PrismaPg,
  type Account as DatabaseAccount,
  type Document as DatabaseDocument,
  type SecurityEvent as DatabaseSecurityEvent,
} from '@lexilens/database';
import type {
  AccountExport,
  DocumentReservation,
  PersistenceHealth,
  PersistencePort,
  PersistencePrincipal,
} from './persistence.port';

const toDatabaseRetention = {
  SESSION: 'SESSION',
  '7_DAYS': 'SEVEN_DAYS',
  '30_DAYS': 'THIRTY_DAYS',
  '90_DAYS': 'NINETY_DAYS',
} as const;

const fromDatabaseRetention = {
  SESSION: 'SESSION',
  SEVEN_DAYS: '7_DAYS',
  THIRTY_DAYS: '30_DAYS',
  NINETY_DAYS: '90_DAYS',
} as const;

function toDocument(document: DatabaseDocument): DocumentRecord {
  return {
    id: document.id,
    ownerId: document.ownerId,
    title: document.title,
    sourceText: document.sourceText,
    contentHash: document.contentHash,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    analysis: document.analysis === null ? null : auditSchema.parse(document.analysis),
    originalFilename: document.originalFilename,
    declaredMime: document.declaredMime as DocumentRecord['declaredMime'],
    detectedMime: document.detectedMime as DocumentRecord['detectedMime'],
    byteSize: document.byteSize,
    scanResult: document.scanResult as DocumentRecord['scanResult'],
    rejectionCode: document.rejectionCode as DocumentRecord['rejectionCode'],
    storageKey: document.storageKey,
    extractionArtifact:
      document.extractionArtifact === null
        ? null
        : extractionArtifactSchema.parse(document.extractionArtifact),
    extractionFailure:
      document.extractionFailure === null
        ? null
        : extractionFailureSchema.parse(document.extractionFailure),
    extractionAttempts: document.extractionAttempts,
    extractionLeaseId: document.extractionLeaseId,
    extractionLeaseExpiresAt: document.extractionLeaseExpiresAt?.toISOString() ?? null,
  };
}

function toAccount(account: DatabaseAccount): Account {
  return {
    ownerId: account.ownerId,
    subject: account.subject,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
    privacy: {
      retentionPolicy: fromDatabaseRetention[account.retentionPolicy],
      consentAccepted: account.consentAccepted,
      consentVersion: account.consentVersion,
      consentedAt: account.consentedAt?.toISOString() ?? null,
    },
  };
}

function toSecurityEvent(event: DatabaseSecurityEvent): SecurityEvent {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    actorMode: event.actorMode,
  };
}

function databaseUrlOptions(databaseUrl: string): {
  connectionString: string;
  schema: string | undefined;
} {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');
  return { connectionString: parsed.toString(), schema };
}

@Injectable()
export class PrismaPersistenceAdapter implements PersistencePort, OnModuleDestroy {
  private readonly client: PrismaClient;
  private readonly schema: string;

  constructor(databaseUrl: string) {
    const { connectionString, schema } = databaseUrlOptions(databaseUrl);
    this.schema = schema ?? 'public';
    const adapter = new PrismaPg({ connectionString }, { schema: this.schema });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async listDocuments(ownerId: string): Promise<DocumentRecord[]> {
    const documents = await this.client.document.findMany({
      where: { ownerId, status: { not: 'DELETED' } },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map(toDocument);
  }

  async findDocument(ownerId: string, id: string): Promise<DocumentRecord | undefined> {
    const document = await this.client.document.findFirst({
      where: { id, ownerId, status: { not: 'DELETED' } },
    });
    return document ? toDocument(document) : undefined;
  }

  async reserveDocument(record: DocumentRecord): Promise<DocumentReservation> {
    await this.client.owner.upsert({
      where: { id: record.ownerId },
      create: { id: record.ownerId },
      update: {},
    });
    const existing = await this.client.document.findFirst({
      where: { ownerId: record.ownerId, activeContentHash: record.contentHash },
    });
    if (existing) return { document: toDocument(existing), created: false };

    try {
      const document = await this.client.document.create({
        data: {
          id: record.id,
          ownerId: record.ownerId,
          title: record.title,
          sourceText: record.sourceText,
          contentHash: record.contentHash,
          activeContentHash: record.contentHash,
          status: record.status,
          analysis: Prisma.DbNull,
          storageKey: record.storageKey,
          originalFilename: record.originalFilename,
          declaredMime: record.declaredMime,
          detectedMime: record.detectedMime,
          byteSize: record.byteSize,
          scanResult: record.scanResult,
          rejectionCode: record.rejectionCode,
          extractionArtifact: Prisma.DbNull,
          extractionFailure: Prisma.DbNull,
          extractionAttempts: record.extractionAttempts,
          extractionLeaseId: null,
          extractionLeaseExpiresAt: null,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
        },
      });
      return { document: toDocument(document), created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const duplicate = await this.client.document.findFirst({
        where: { ownerId: record.ownerId, activeContentHash: record.contentHash },
      });
      if (!duplicate) throw error;
      return { document: toDocument(duplicate), created: false };
    }
  }

  async transitionDocument(
    ownerId: string,
    id: string,
    status: ProcessingStatus,
    analysis: Audit | null,
  ): Promise<DocumentRecord | undefined> {
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: { not: 'DELETED' } },
      data: {
        status,
        analysis:
          analysis === null ? Prisma.DbNull : (analysis as unknown as Prisma.InputJsonValue),
      },
    });
    if (updated.count === 0) return undefined;
    return this.findDocument(ownerId, id);
  }

  async updateUploadMetadata(
    ownerId: string,
    id: string,
    metadata: Pick<DocumentRecord, 'detectedMime' | 'scanResult' | 'rejectionCode'>,
  ): Promise<DocumentRecord | undefined> {
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: { not: 'DELETED' } },
      data: metadata,
    });
    return updated.count ? this.findDocument(ownerId, id) : undefined;
  }

  async claimReadyForExtraction(ownerId: string, id: string, leaseMs: number) {
    const leaseId = randomUUID();
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: 'READY_FOR_EXTRACTION', scanResult: 'CLEAN' },
      data: {
        status: 'PROCESSING',
        extractionAttempts: { increment: 1 },
        extractionLeaseId: leaseId,
        extractionLeaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
    if (!updated.count) return undefined;
    const document = await this.findDocument(ownerId, id);
    return document ? { document, leaseId } : undefined;
  }

  async completeExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: import('@lexilens/contracts').ExtractionArtifact,
    analysis: Audit,
  ): Promise<DocumentRecord | undefined> {
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: 'PROCESSING', extractionLeaseId: leaseId },
      data: {
        status: 'COMPLETED',
        sourceText: artifact.canonicalText,
        extractionArtifact: artifact as unknown as Prisma.InputJsonValue,
        extractionFailure: Prisma.DbNull,
        extractionLeaseId: null,
        extractionLeaseExpiresAt: null,
        analysis: analysis as unknown as Prisma.InputJsonValue,
      },
    });
    return updated.count ? this.findDocument(ownerId, id) : undefined;
  }

  async failExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: import('@lexilens/contracts').ExtractionArtifact | null,
    failure: import('@lexilens/contracts').ExtractionFailure,
  ): Promise<DocumentRecord | undefined> {
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: 'PROCESSING', extractionLeaseId: leaseId },
      data: {
        status: 'FAILED',
        extractionArtifact:
          artifact === null ? Prisma.DbNull : (artifact as unknown as Prisma.InputJsonValue),
        extractionFailure: failure as unknown as Prisma.InputJsonValue,
        extractionLeaseId: null,
        extractionLeaseExpiresAt: null,
        analysis: Prisma.DbNull,
      },
    });
    return updated.count ? this.findDocument(ownerId, id) : undefined;
  }

  async listStorageKeys(ownerId: string): Promise<string[]> {
    const documents = await this.client.document.findMany({
      where: { ownerId, storageKey: { not: null } },
      select: { storageKey: true },
    });
    return documents.flatMap((document) => (document.storageKey ? [document.storageKey] : []));
  }

  async softDeleteDocument(ownerId: string, id: string): Promise<boolean> {
    const updated = await this.client.document.updateMany({
      where: { id, ownerId, status: { not: 'DELETED' } },
      data: {
        sourceText: '',
        analysis: Prisma.DbNull,
        activeContentHash: null,
        status: 'DELETED',
      },
    });
    return updated.count === 1;
  }

  async getOrCreateAccount(principal: PersistencePrincipal): Promise<Account> {
    return this.client.$transaction(async (transaction) => {
      return toAccount(await this.ensureAccount(transaction, principal));
    });
  }

  async updatePrivacy(
    principal: PersistencePrincipal,
    input: UpdatePrivacyPreferences,
  ): Promise<Account> {
    return this.client.$transaction(async (transaction) => {
      await this.ensureAccount(transaction, principal);
      const account = await transaction.account.update({
        where: { ownerId: principal.ownerId },
        data: {
          ...(input.retentionPolicy === undefined
            ? {}
            : { retentionPolicy: toDatabaseRetention[input.retentionPolicy] }),
          ...(input.acceptConsentVersion === undefined
            ? {}
            : {
                consentAccepted: true,
                consentVersion: input.acceptConsentVersion,
                consentedAt: new Date(),
              }),
        },
      });
      await this.record(transaction, principal, 'PRIVACY_UPDATED');
      return toAccount(account);
    });
  }

  async exportAccount(principal: PersistencePrincipal): Promise<AccountExport> {
    return this.client.$transaction(
      async (transaction) => {
        const account = await this.ensureAccount(transaction, principal);
        await this.record(transaction, principal, 'DATA_EXPORTED');
        const [documents, securityEvents] = await Promise.all([
          transaction.document.findMany({
            where: { ownerId: principal.ownerId, status: { not: 'DELETED' } },
            orderBy: { createdAt: 'desc' },
          }),
          transaction.securityEvent.findMany({
            where: { ownerId: principal.ownerId },
            orderBy: { sequence: 'asc' },
          }),
        ]);
        return {
          exportedAt: new Date().toISOString(),
          account: toAccount(account),
          documents: documents.map(toDocument),
          securityEvents: securityEvents.map(toSecurityEvent),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  async deleteOwner(
    principal: PersistencePrincipal,
  ): Promise<{ status: 'DELETED'; purgedDocuments: number }> {
    return this.client.$transaction(async (transaction) => {
      await this.ensureAccount(transaction, principal);
      await this.record(transaction, principal, 'ACCOUNT_DELETED');
      const purgedDocuments = await transaction.document.count({
        where: { ownerId: principal.ownerId },
      });
      await transaction.owner.delete({ where: { id: principal.ownerId } });
      return { status: 'DELETED' as const, purgedDocuments };
    });
  }

  async listSecurityEvents(ownerId: string): Promise<SecurityEvent[]> {
    const events = await this.client.securityEvent.findMany({
      where: { ownerId },
      orderBy: { sequence: 'asc' },
    });
    return events.map(toSecurityEvent);
  }

  async health(): Promise<PersistenceHealth> {
    try {
      const migrationTable = Prisma.raw(
        `"${this.schema.replaceAll('"', '""')}"."_prisma_migrations"`,
      );
      const migrations = await this.client.$queryRaw<Array<{ migration_name: string }>>(
        Prisma.sql`
          SELECT "migration_name"
          FROM ${migrationTable}
          WHERE "migration_name" = ${DATABASE_SCHEMA_VERSION}
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
          LIMIT 1
        `,
      );
      if (migrations.length !== 1) {
        return {
          healthy: false,
          mode: 'postgresql',
          schemaVersion: DATABASE_SCHEMA_VERSION,
        };
      }
      await Promise.all([
        this.client.owner.count(),
        this.client.account.count(),
        this.client.document.count(),
        this.client.securityEvent.count(),
      ]);
      return { healthy: true, mode: 'postgresql', schemaVersion: DATABASE_SCHEMA_VERSION };
    } catch {
      return { healthy: false, mode: 'postgresql', schemaVersion: DATABASE_SCHEMA_VERSION };
    }
  }

  private async ensureAccount(
    transaction: Prisma.TransactionClient,
    principal: PersistencePrincipal,
  ): Promise<DatabaseAccount> {
    await transaction.owner.upsert({
      where: { id: principal.ownerId },
      create: { id: principal.ownerId },
      update: {},
    });
    const created = await transaction.account.createMany({
      data: {
        ownerId: principal.ownerId,
        subject: principal.subject,
        retentionPolicy: 'SESSION',
        consentAccepted: false,
      },
      skipDuplicates: true,
    });
    if (created.count === 1) {
      await this.record(transaction, principal, 'ACCOUNT_INITIALIZED');
    }
    return transaction.account.findUniqueOrThrow({ where: { ownerId: principal.ownerId } });
  }

  private async record(
    transaction: Prisma.TransactionClient,
    principal: PersistencePrincipal,
    type: SecurityEvent['type'],
  ): Promise<void> {
    await transaction.securityEvent.create({
      data: {
        ownerId: principal.ownerId,
        type,
        actorMode: principal.mode,
      },
    });
  }
}
