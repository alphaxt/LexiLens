import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Account, SecurityEvent, UpdatePrivacyPreferences } from '@lexilens/contracts';
import type { AuthPrincipal } from './auth/identity';
import { DocumentService } from './documents.service';

@Injectable()
export class AccountService {
  private readonly accounts = new Map<string, Account>();
  private readonly events = new Map<string, SecurityEvent[]>();

  constructor(private readonly documents: DocumentService) {}

  get(principal: AuthPrincipal): Account {
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

  update(principal: AuthPrincipal, input: UpdatePrivacyPreferences): Account {
    const current = this.get(principal);
    const now = new Date().toISOString();
    const account: Account = {
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
    this.accounts.set(principal.ownerId, account);
    this.record(principal, 'PRIVACY_UPDATED');
    return account;
  }

  export(principal: AuthPrincipal) {
    const account = this.get(principal);
    this.record(principal, 'DATA_EXPORTED');
    return {
      exportedAt: new Date().toISOString(),
      account,
      documents: this.documents.list(principal.ownerId),
      securityEvents: this.auditLog(principal),
    };
  }

  delete(principal: AuthPrincipal): { status: 'DELETED'; purgedDocuments: number } {
    this.get(principal);
    this.record(principal, 'ACCOUNT_DELETED');
    const purgedDocuments = this.documents.purgeOwner(principal.ownerId);
    this.accounts.delete(principal.ownerId);
    this.events.delete(principal.ownerId);
    return { status: 'DELETED', purgedDocuments };
  }

  auditLog(principal: AuthPrincipal): SecurityEvent[] {
    return [...(this.events.get(principal.ownerId) ?? [])];
  }

  private record(principal: AuthPrincipal, type: SecurityEvent['type']): void {
    const event: SecurityEvent = {
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      actorMode: principal.mode,
    };
    this.events.set(principal.ownerId, [...(this.events.get(principal.ownerId) ?? []), event]);
  }
}
