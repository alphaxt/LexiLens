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
  private nextSequence = 1;

  async listDocuments(ownerId: string): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .filter((document) => document.ownerId === ownerId && document.status !== 'DELETED')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clone);
  }

  async findDocument(ownerId: string, id: string): Promise<DocumentRecord | undefined> {
    const document = this.documents.get(id);
    if (!document || document.ownerId !== ownerId || document.status === 'DELETED')
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

  async listStorageKeys(ownerId: string): Promise<string[]> {
    return [...this.documents.values()]
      .filter((document) => document.ownerId === ownerId && document.storageKey)
      .map((document) => document.storageKey!);
  }

  async softDeleteDocument(ownerId: string, id: string): Promise<boolean> {
    const current = this.documents.get(id);
    if (!current || current.ownerId !== ownerId || current.status === 'DELETED') return false;
    this.documents.set(id, {
      ...current,
      sourceText: '',
      analysis: null,
      status: 'DELETED',
      updatedAt: new Date().toISOString(),
    });
    return true;
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
