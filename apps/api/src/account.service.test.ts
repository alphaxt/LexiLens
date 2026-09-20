import { describe, expect, it } from 'vitest';
import type { AuthPrincipal } from './auth/identity';
import { AccountService } from './account.service';
import { DocumentService } from './documents.service';

const principal: AuthPrincipal = {
  ownerId: 'local:test-owner',
  subject: 'test-owner',
  mode: 'local',
  scopes: [],
};

describe('AccountService privacy lifecycle', () => {
  it('versions consent and records content-free security events', () => {
    const service = new AccountService(new DocumentService());
    const updated = service.update(principal, {
      retentionPolicy: '30_DAYS',
      acceptConsentVersion: 'privacy-v1',
    });
    expect(updated.privacy).toMatchObject({
      retentionPolicy: '30_DAYS',
      consentAccepted: true,
      consentVersion: 'privacy-v1',
    });
    expect(service.auditLog(principal).map((event) => event.type)).toEqual([
      'ACCOUNT_INITIALIZED',
      'PRIVACY_UPDATED',
    ]);
    expect(JSON.stringify(service.auditLog(principal))).not.toContain('sourceText');
  });

  it('exports owned data and purges every owned document on deletion', () => {
    const documents = new DocumentService();
    documents.create(principal.ownerId, {
      title: 'Terms',
      text: 'This membership will automatically renew.',
      mimeType: 'text/plain',
    });
    const service = new AccountService(documents);
    const exported = service.export(principal);
    expect(exported.documents).toHaveLength(1);
    expect(exported.securityEvents.at(-1)?.type).toBe('DATA_EXPORTED');
    expect(service.delete(principal)).toEqual({ status: 'DELETED', purgedDocuments: 1 });
    expect(documents.list(principal.ownerId)).toEqual([]);
  });
});
