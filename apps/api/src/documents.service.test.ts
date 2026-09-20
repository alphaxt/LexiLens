import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentService } from './documents.service';

const ownerA = '9f7cc982-50e7-4f2b-8ff5-b5100cc0bf09';
const ownerB = '724310dd-d659-4ea6-8c4b-45199b90bff8';

describe('DocumentService boundaries', () => {
  beforeEach(() => {
    process.env.ENABLE_HEALTHCARE_ANALYSIS = 'false';
  });

  it('rejects likely healthcare content before storing it', () => {
    const service = new DocumentService();
    expect(() => service.create(ownerA, { title: 'Consent', text: 'Patient medical consent for hospital care.', mimeType: 'text/plain' })).toThrow(BadRequestException);
    expect(() => service.create(ownerA, { title: 'Authorization', text: 'The clinic may renew this chemotherapy treatment authorization.', mimeType: 'text/plain' })).toThrow(BadRequestException);
    expect(service.list(ownerA)).toEqual([]);
  });

  it('fails closed when the document domain cannot be confidently allowlisted', () => {
    const service = new DocumentService();
    expect(() => service.create(ownerA, { title: 'Unknown', text: 'A dense document with no supported domain markers.', mimeType: 'text/plain' })).toThrow(BadRequestException);
    expect(service.list(ownerA)).toEqual([]);
  });

  it('fails closed for domain packs not enabled in the consumer MVP', () => {
    const service = new DocumentService();
    expect(() => service.create(ownerA, { title: 'Lease', text: 'Tenant shall pay rent to the landlord.', mimeType: 'text/plain' })).toThrow(BadRequestException);
  });

  it('does not disclose a document to another local session', () => {
    const service = new DocumentService();
    const record = service.create(ownerA, { title: 'Terms', text: 'This membership will automatically renew.', mimeType: 'text/plain' });
    expect(() => service.get(ownerB, record.id)).toThrow(NotFoundException);
  });

  it('supports distinct evidence-linked dispute drafts', () => {
    const service = new DocumentService();
    const record = service.create(ownerA, { title: 'Terms', text: 'A $75 late fee applies.', mimeType: 'text/plain' });
    const clauseId = record.analysis!.clauses[0]!.clauseId;
    const draft = service.createDraft(ownerA, record.id, { clauseIds: [clauseId], recipientRole: 'Billing team', tone: 'firm', draftType: 'dispute' });
    expect(draft.subjectLine).toContain('Dispute');
    expect(draft.sourceClauseIds).toEqual([clauseId]);
    expect(draft.formalLetterDraft).toContain('I request');
  });
});
