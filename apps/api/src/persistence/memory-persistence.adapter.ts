import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  Account,
  Audit,
  DocumentRecord,
  ProcessingStatus,
  SecurityEvent,
  UpdatePrivacyPreferences,
} from '@lexilens/contracts';
import { DATABASE_SCHEMA_VERSION } from '@lexilens/database';
import type {
  AccountExport,
  DocumentReservation,
  PersistenceHealth,
  PersistencePort,
  PersistencePrincipal,
} from './persistence.port';

type SequencedEvent = SecurityEvent & { sequence: number };

function clone<T>(value: T): T {
  return structuredClone(value);
}

@Injectable()
export class MemoryPersistenceAdapter implements PersistencePort {
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly accounts = new Map<string, Account>();
  private readonly events = new Map<string, SequencedEvent[]>();
  private readonly cleanupTasks = new Map<
    string,
    import('./persistence.port').CleanupTask & {
      state: 'PENDING' | 'LEASED' | 'SUCCEEDED';
      nextAttemptAt: number;
      leaseExpiresAt: number | null;
      documentDeleted: boolean;
    }
  >();
  private readonly deletingOwners = new Set<string>();
  private nextSequence = 1;

  async listDocuments(ownerId: string): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.ownerId === ownerId && !['DELETED', 'DELETE_PENDING'].includes(document.status),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clone);
  }

  async findDocument(ownerId: string, id: string): Promise<DocumentRecord | undefined> {
    const document = this.documents.get(id);
    if (
      !document ||
      document.ownerId !== ownerId ||
      ['DELETED', 'DELETE_PENDING'].includes(document.status)
    )
      return undefined;
    return clone(document);
  }

  async reserveDocument(record: DocumentRecord): Promise<DocumentReservation> {
    const existing = [...this.documents.values()].find(
      (candidate) =>
        candidate.ownerId === record.ownerId &&
        candidate.status !== 'DELETED' &&
        candidate.contentHash === record.contentHash,
    );
    if (existing) return { document: clone(existing), created: false };
    this.documents.set(record.id, clone(record));
    return { document: clone(record), created: true };
  }

  async transitionDocument(
    ownerId: string,
    id: string,
    status: ProcessingStatus,
    analysis: Audit | null,
  ): Promise<DocumentRecord | undefined> {
    const current = this.documents.get(id);
    if (!current || current.ownerId !== ownerId || current.status === 'DELETED') return undefined;
    const updated: DocumentRecord = {
      ...current,
      status,
      analysis: clone(analysis),
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return clone(updated);
  }

  async updateUploadMetadata(
    ownerId: string,
    id: string,
    metadata: Pick<DocumentRecord, 'detectedMime' | 'scanResult' | 'rejectionCode'>,
  ): Promise<DocumentRecord | undefined> {
    const current = this.documents.get(id);
    if (!current || current.ownerId !== ownerId || current.status === 'DELETED') return undefined;
    const updated = { ...current, ...metadata, updatedAt: new Date().toISOString() };
    this.documents.set(id, updated);
    return clone(updated);
  }

  async claimReadyForExtraction(ownerId: string, id: string, leaseMs: number) {
    const current = this.documents.get(id);
    if (
      !current ||
      current.ownerId !== ownerId ||
      current.status !== 'READY_FOR_EXTRACTION' ||
      current.scanResult !== 'CLEAN'
    )
      return undefined;
    const leaseId = randomUUID();
    const updated = {
      ...current,
      status: 'PROCESSING' as const,
      extractionAttempts: current.extractionAttempts + 1,
      extractionLeaseId: leaseId,
      extractionLeaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return { document: clone(updated), leaseId };
  }

  async completeExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: import('@lexilens/contracts').ExtractionArtifact,
    analysis: Audit,
  ): Promise<DocumentRecord | undefined> {
    const current = this.documents.get(id);
    if (
      !current ||
      current.ownerId !== ownerId ||
      current.status !== 'PROCESSING' ||
      current.extractionLeaseId !== leaseId ||
      !current.extractionLeaseExpiresAt ||
      new Date(current.extractionLeaseExpiresAt).getTime() <= Date.now()
    )
      return undefined;
    const updated = {
      ...current,
      sourceText: artifact.canonicalText,
      extractionArtifact: clone(artifact),
      extractionFailure: null,
      extractionLeaseId: null,
      extractionLeaseExpiresAt: null,
      status: 'COMPLETED' as const,
      analysis: clone(analysis),
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return clone(updated);
  }

  async failExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: import('@lexilens/contracts').ExtractionArtifact | null,
    extractionFailure: import('@lexilens/contracts').ExtractionFailure,
  ): Promise<DocumentRecord | undefined> {
    const current = this.documents.get(id);
    if (
      !current ||
      current.ownerId !== ownerId ||
      current.status !== 'PROCESSING' ||
      current.extractionLeaseId !== leaseId ||
      !current.extractionLeaseExpiresAt ||
      new Date(current.extractionLeaseExpiresAt).getTime() <= Date.now()
    )
      return undefined;
    const updated = {
      ...current,
      extractionArtifact: artifact ? clone(artifact) : null,
      extractionFailure: clone(extractionFailure),
      extractionLeaseId: null,
      extractionLeaseExpiresAt: null,
      status: 'FAILED' as const,
      analysis: null,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return clone(updated);
  }

  async reconcileExpiredExtractionLeases(maxAttempts: number, batchSize: number, now = new Date()) {
    let requeued = 0;
    let exhausted = 0;
    const expired = [...this.documents.values()]
      .filter(
        (document) =>
          document.status === 'PROCESSING' &&
          document.extractionLeaseExpiresAt !== null &&
          new Date(document.extractionLeaseExpiresAt).getTime() <= now.getTime(),
      )
      .sort((left, right) =>
        left.extractionLeaseExpiresAt!.localeCompare(right.extractionLeaseExpiresAt!),
      )
      .slice(0, batchSize);
    for (const current of expired) {
      // The map lookup is the in-memory compare-and-set fence used by concurrent callers.
      if (
        this.documents.get(current.id)?.status !== 'PROCESSING' ||
        this.documents.get(current.id)?.extractionLeaseId !== current.extractionLeaseId ||
        this.documents.get(current.id)?.extractionLeaseExpiresAt !==
          current.extractionLeaseExpiresAt
      )
        continue;
      const updatedAt = new Date().toISOString();
      if (current.extractionAttempts < maxAttempts) {
        this.documents.set(current.id, {
          ...current,
          status: 'READY_FOR_EXTRACTION',
          extractionLeaseId: null,
          extractionLeaseExpiresAt: null,
          updatedAt,
        });
        requeued += 1;
      } else {
        this.documents.set(current.id, {
          ...current,
          status: 'FAILED',
          extractionLeaseId: null,
          extractionLeaseExpiresAt: null,
          extractionFailure: {
            code: 'EXTRACTION_TIMEOUT',
            message: 'Extraction lease expired after the configured retry limit.',
            retryable: false,
            occurredAt: updatedAt,
            pageNumber: null,
          },
          analysis: null,
          updatedAt,
        });
        exhausted += 1;
      }
    }
    return { requeued, exhausted };
  }

  async listStorageKeys(ownerId: string): Promise<string[]> {
    return [...this.documents.values()]
      .filter((document) => document.ownerId === ownerId && document.storageKey)
      .map((document) => document.storageKey!);
  }

  async softDeleteDocument(ownerId: string, id: string): Promise<boolean> {
    const result = await this.requestDocumentDeletion(ownerId, id);
    return result?.status === 'DELETED';
  }

  async requestDocumentDeletion(
    ownerId: string,
    id: string,
    reason: import('./persistence.port').CleanupReason = 'USER_DELETE',
  ) {
    const current = this.documents.get(id);
    if (!current || current.ownerId !== ownerId || current.status === 'DELETED') return undefined;
    if (!current.storageKey) {
      this.finalizeDocument(id);
      return { status: 'DELETED' as const };
    }
    this.enqueueTask(ownerId, id, current.storageKey, reason);
    this.documents.set(id, {
      ...current,
      status: 'DELETE_PENDING',
      updatedAt: new Date().toISOString(),
    });
    return { status: 'PENDING' as const };
  }

  async requestAccountDeletion(principal: PersistencePrincipal) {
    this.ensureAccount(principal);
    this.deletingOwners.add(principal.ownerId);
    const documents = [...this.documents.values()].filter(
      (document) => document.ownerId === principal.ownerId && document.status !== 'DELETED',
    );
    for (const document of documents) {
      if (document.storageKey) {
        this.enqueueTask(principal.ownerId, document.id, document.storageKey, 'ACCOUNT_DELETE');
        this.documents.set(document.id, {
          ...document,
          status: 'DELETE_PENDING',
          updatedAt: new Date().toISOString(),
        });
      } else this.finalizeDocument(document.id);
    }
    return { status: 'PENDING' as const, purgedDocuments: documents.length };
  }

  async enqueueExpiredRetention(batchSize: number, now = new Date()) {
    let queued = 0;
    for (const document of [...this.documents.values()]
      .filter(
        (candidate) =>
          candidate.status !== 'DELETED' &&
          new Date(candidate.createdAt).getTime() <= now.getTime(),
      )
      .slice(0, batchSize)) {
      // SESSION is deliberately excluded: it is session-bound client data and has no server expiry basis.
      const account = this.accounts.get(document.ownerId);
      const days =
        account?.privacy.retentionPolicy === '7_DAYS'
          ? 7
          : account?.privacy.retentionPolicy === '30_DAYS'
            ? 30
            : account?.privacy.retentionPolicy === '90_DAYS'
              ? 90
              : 0;
      if (days && new Date(document.createdAt).getTime() + days * 86400000 <= now.getTime()) {
        const result = await this.requestDocumentDeletion(
          document.ownerId,
          document.id,
          'RETENTION_EXPIRED',
        );
        if (result) queued += 1;
      }
    }
    return queued;
  }

  async claimCleanupTasks(batchSize: number, leaseMs: number, now = new Date()) {
    const tasks = [...this.cleanupTasks.values()]
      .filter((task) => task.state === 'PENDING' && task.nextAttemptAt <= now.getTime())
      .slice(0, batchSize);
    return tasks.map((task) => {
      const leaseId = randomUUID();
      task.state = 'LEASED';
      task.leaseId = leaseId;
      task.leaseExpiresAt = now.getTime() + leaseMs;
      task.attempts += 1;
      return clone({
        id: task.id,
        ownerId: task.ownerId,
        documentId: task.documentId,
        objectKey: task.objectKey,
        reason: task.reason,
        attempts: task.attempts,
        leaseId,
      });
    });
  }

  async completeCleanupTask(task: import('./persistence.port').CleanupTask) {
    const stored = this.cleanupTasks.get(task.id);
    if (!stored || stored.state !== 'LEASED' || stored.leaseId !== task.leaseId) return;
    stored.state = 'SUCCEEDED';
    stored.leaseExpiresAt = null;
    if (stored.documentId) this.finalizeDocument(stored.documentId);
  }

  async failCleanupTask(
    task: import('./persistence.port').CleanupTask,
    _errorCode: string,
    retryAfterMs: number,
  ) {
    const stored = this.cleanupTasks.get(task.id);
    if (!stored || stored.state !== 'LEASED' || stored.leaseId !== task.leaseId) return;
    stored.state = 'PENDING';
    stored.leaseExpiresAt = null;
    stored.nextAttemptAt = Date.now() + retryAfterMs;
  }

  async finalizeDeletedAccounts() {
    let finalized = 0;
    for (const ownerId of [...this.deletingOwners]) {
      const pending = [...this.cleanupTasks.values()].some(
        (task) => task.ownerId === ownerId && task.state !== 'SUCCEEDED',
      );
      if (!pending) {
        const count = [...this.documents.values()].filter(
          (document) => document.ownerId === ownerId,
        ).length;
        for (const document of [...this.documents.values()].filter(
          (candidate) => candidate.ownerId === ownerId,
        ))
          this.finalizeDocument(document.id);
        this.accounts.delete(ownerId);
        this.events.delete(ownerId);
        this.deletingOwners.delete(ownerId);
        finalized += count > -1 ? 1 : 0;
      }
    }
    return finalized;
  }

  async getOrCreateAccount(principal: PersistencePrincipal): Promise<Account> {
    return clone(this.ensureAccount(principal));
  }

  async updatePrivacy(
    principal: PersistencePrincipal,
    input: UpdatePrivacyPreferences,
  ): Promise<Account> {
    const current = this.ensureAccount(principal);
    const now = new Date().toISOString();
    const updated: Account = {
      ...current,
      updatedAt: now,
      privacy: {
        ...current.privacy,
        retentionPolicy: input.retentionPolicy ?? current.privacy.retentionPolicy,
        consentAccepted: input.acceptConsentVersion ? true : current.privacy.consentAccepted,
        consentVersion: input.acceptConsentVersion ?? current.privacy.consentVersion,
        consentedAt: input.acceptConsentVersion ? now : current.privacy.consentedAt,
      },
    };
    this.accounts.set(principal.ownerId, updated);
    this.record(principal, 'PRIVACY_UPDATED');
    return clone(updated);
  }

  async exportAccount(principal: PersistencePrincipal): Promise<AccountExport> {
    const account = this.ensureAccount(principal);
    this.record(principal, 'DATA_EXPORTED');
    return {
      exportedAt: new Date().toISOString(),
      account: clone(account),
      documents: await this.listDocuments(principal.ownerId),
      securityEvents: await this.listSecurityEvents(principal.ownerId),
    };
  }

  async deleteOwner(
    principal: PersistencePrincipal,
  ): Promise<{ status: 'DELETED'; purgedDocuments: number }> {
    this.ensureAccount(principal);
    this.record(principal, 'ACCOUNT_DELETED');
    const ownedIds = [...this.documents.values()]
      .filter((document) => document.ownerId === principal.ownerId)
      .map((document) => document.id);
    for (const id of ownedIds) this.documents.delete(id);
    this.accounts.delete(principal.ownerId);
    this.events.delete(principal.ownerId);
    return { status: 'DELETED', purgedDocuments: ownedIds.length };
  }

  async listSecurityEvents(ownerId: string): Promise<SecurityEvent[]> {
    return [...(this.events.get(ownerId) ?? [])]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ sequence: _sequence, ...event }) => clone(event));
  }

  async health(): Promise<PersistenceHealth> {
    return { healthy: true, mode: 'memory', schemaVersion: DATABASE_SCHEMA_VERSION };
  }

  private enqueueTask(
    ownerId: string,
    documentId: string,
    objectKey: string,
    reason: import('./persistence.port').CleanupReason,
  ): void {
    const existing = [...this.cleanupTasks.values()].find(
      (task) =>
        task.documentId === documentId && task.objectKey === objectKey && task.reason === reason,
    );
    if (existing) return;
    const id = randomUUID();
    this.cleanupTasks.set(id, {
      id,
      ownerId,
      documentId,
      objectKey,
      reason,
      attempts: 0,
      leaseId: '',
      state: 'PENDING',
      nextAttemptAt: Date.now(),
      leaseExpiresAt: null,
      documentDeleted: false,
    });
  }

  private finalizeDocument(id: string): void {
    const current = this.documents.get(id);
    if (!current || current.status === 'DELETED') return;
    this.documents.set(id, {
      ...current,
      sourceText: '',
      analysis: null,
      storageKey: null,
      originalFilename: null,
      declaredMime: null,
      detectedMime: null,
      byteSize: null,
      scanResult: null,
      rejectionCode: null,
      extractionArtifact: null,
      extractionFailure: null,
      extractionLeaseId: null,
      extractionLeaseExpiresAt: null,
      status: 'DELETED',
      updatedAt: new Date().toISOString(),
    });
  }

  private ensureAccount(principal: PersistencePrincipal): Account {
    const existing = this.accounts.get(principal.ownerId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const account: Account = {
      ownerId: principal.ownerId,
      subject: principal.subject,
      createdAt: now,
      updatedAt: now,
      privacy: {
        retentionPolicy: 'SESSION',
        consentAccepted: false,
        consentVersion: null,
        consentedAt: null,
      },
    };
    this.accounts.set(principal.ownerId, account);
    this.record(principal, 'ACCOUNT_INITIALIZED');
    return account;
  }

  private record(principal: PersistencePrincipal, type: SecurityEvent['type']): void {
    const event: SequencedEvent = {
      sequence: this.nextSequence++,
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      actorMode: principal.mode,
    };
    this.events.set(principal.ownerId, [...(this.events.get(principal.ownerId) ?? []), event]);
  }
}
