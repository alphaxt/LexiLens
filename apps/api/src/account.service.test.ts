import { describe, expect, it } from 'vitest';
import type { AuthPrincipal } from './auth/identity';
import { AccountService } from './account.service';
import { DocumentService } from './documents.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';

const principal: AuthPrincipal = {
  ownerId: 'local:test-owner',
  subject: 'test-owner',
  mode: 'local',
  scopes: [],
};

function setup() {
  const persistence = new MemoryPersistenceAdapter();
  return {
    persistence,
    accounts: new AccountService(persistence),
    documents: new DocumentService(persistence),
  };
}

describe('AccountService privacy lifecycle', () => {
  it('versions consent and records ordered, content-free security events', async () => {
    const { accounts } = setup();
    const updated = await accounts.update(principal, {
      retentionPolicy: '30_DAYS',
      acceptConsentVersion: 'privacy-v1',
    });
    expect(updated.privacy).toMatchObject({
      retentionPolicy: '30_DAYS',
      consentAccepted: true,
      consentVersion: 'privacy-v1',
    });

    const events = await accounts.auditLog(principal);
    expect(events.map((event) => event.type)).toEqual(['ACCOUNT_INITIALIZED', 'PRIVACY_UPDATED']);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['actorMode', 'id', 'occurredAt', 'type']);
    }
    expect(JSON.stringify(events)).not.toContain(principal.ownerId);
  });

  it('keeps consent acceptance sticky when only retention changes', async () => {
    const { accounts } = setup();
    await accounts.update(principal, { acceptConsentVersion: 'privacy-v1' });
    const updated = await accounts.update(principal, { retentionPolicy: '7_DAYS' });
    expect(updated.privacy).toMatchObject({
      retentionPolicy: '7_DAYS',
      consentAccepted: true,
      consentVersion: 'privacy-v1',
    });
  });

  it('exports account, active documents, and the export event from one operation', async () => {
    const { accounts, documents } = setup();
    await documents.create(principal.ownerId, {
      title: 'Terms',
      text: 'This membership will automatically renew.',
      mimeType: 'text/plain',
    });

    const exported = await accounts.export(principal);
    expect(exported.documents).toHaveLength(1);
    expect(exported.securityEvents.map((event) => event.type)).toEqual([
      'ACCOUNT_INITIALIZED',
      'DATA_EXPORTED',
    ]);
    expect(exported.exportedAt).toMatch(/Z$/);
  });

  it('transactionally deletes the owner and counts active and soft-deleted documents', async () => {
    const { accounts, documents } = setup();
    const first = await documents.create(principal.ownerId, {
      title: 'First',
      text: 'This membership will automatically renew.',
      mimeType: 'text/plain',
    });
    await documents.delete(principal.ownerId, first.id);
    await documents.create(principal.ownerId, {
      title: 'Second',
      text: 'A $75 late fee applies.',
      mimeType: 'text/plain',
    });

    await expect(accounts.delete(principal)).resolves.toEqual({
      status: 'DELETED',
      purgedDocuments: 2,
    });
    await expect(documents.list(principal.ownerId)).resolves.toEqual([]);
    await expect(accounts.auditLog(principal)).resolves.toEqual([]);
    await accounts.get(principal);
    await expect(accounts.auditLog(principal)).resolves.toMatchObject([
      { type: 'ACCOUNT_INITIALIZED' },
    ]);
  });
});
