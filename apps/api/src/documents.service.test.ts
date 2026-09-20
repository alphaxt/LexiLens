import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from './documents.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';

const ownerA = 'local:9f7cc982-50e7-4f2b-8ff5-b5100cc0bf09';
const ownerB = 'local:724310dd-d659-4ea6-8c4b-45199b90bff8';
const consumerDocument = {
  title: 'Terms',
  text: 'This membership will automatically renew and a $75 late fee applies.',
  mimeType: 'text/plain' as const,
};

function setup() {
  const persistence = new MemoryPersistenceAdapter();
  return { persistence, service: new DocumentService(persistence) };
}

describe('DocumentService persistence boundaries', () => {
  beforeEach(() => {
    process.env.ENABLE_HEALTHCARE_ANALYSIS = 'false';
    process.env.PERSISTENCE_MODE = 'memory';
  });

  it.each([
    ['healthcare', 'Patient medical consent for hospital care.'],
    ['unknown', 'A dense document with no supported domain markers.'],
    ['disabled housing', 'Tenant shall pay rent to the landlord.'],
  ])('rejects %s content before storing it', async (_label, text) => {
    const { service } = setup();
    await expect(
      service.create(ownerA, { title: 'Unsupported', text, mimeType: 'text/plain' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(ownerA)).resolves.toEqual([]);
  });

  it('reserves quarantine before processing and completion', async () => {
    const { persistence, service } = setup();
    const reserve = vi.spyOn(persistence, 'reserveDocument');
    const transition = vi.spyOn(persistence, 'transitionDocument');

    const record = await service.create(ownerA, consumerDocument);

    expect(reserve.mock.calls[0]?.[0].status).toBe('QUARANTINED');
    expect(transition.mock.calls.map((call) => call[2])).toEqual(['PROCESSING', 'COMPLETED']);
    expect(record.status).toBe('COMPLETED');
    expect(record.analysis).not.toBeNull();
  });

  it('resumes a nonterminal duplicate left by an interrupted attempt', async () => {
    const { persistence, service } = setup();
    const interruptedTransition = vi
      .spyOn(persistence, 'transitionDocument')
      .mockRejectedValueOnce(new Error('simulated interruption'));

    await expect(service.create(ownerA, consumerDocument)).rejects.toThrow(
      'simulated interruption',
    );
    interruptedTransition.mockRestore();
    const [stranded] = await service.list(ownerA);
    expect(stranded?.status).toBe('QUARANTINED');

    const resumed = await service.create(ownerA, consumerDocument);
    expect(resumed.id).toBe(stranded?.id);
    expect(resumed.status).toBe('COMPLETED');
  });

  it('deduplicates active owner content but not content owned by someone else', async () => {
    const { service } = setup();
    const [first, duplicate] = await Promise.all([
      service.create(ownerA, consumerDocument),
      service.create(ownerA, { ...consumerDocument, title: 'Renamed duplicate' }),
    ]);
    const otherOwner = await service.create(ownerB, consumerDocument);

    expect(duplicate.id).toBe(first.id);
    expect(otherOwner.id).not.toBe(first.id);
    await expect(service.list(ownerA)).resolves.toHaveLength(1);
  });

  it('soft deletes, hides, and permits re-uploading the same content with a new id', async () => {
    const { service } = setup();
    const first = await service.create(ownerA, consumerDocument);
    await expect(service.delete(ownerA, first.id)).resolves.toEqual({
      id: first.id,
      status: 'DELETED',
    });
    await expect(service.get(ownerA, first.id)).rejects.toThrow('Document not found.');
    await expect(service.list(ownerA)).resolves.toEqual([]);

    const replacement = await service.create(ownerA, consumerDocument);
    expect(replacement.id).not.toBe(first.id);
  });

  it('uses the same non-disclosing not-found result for missing, foreign, and deleted records', async () => {
    const { service } = setup();
    const record = await service.create(ownerA, consumerDocument);

    await expect(service.get(ownerB, record.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(ownerB, record.id)).rejects.toThrow('Document not found.');
    await service.delete(ownerA, record.id);
    await expect(service.get(ownerA, record.id)).rejects.toThrow('Document not found.');
    await expect(service.get(ownerA, crypto.randomUUID())).rejects.toThrow('Document not found.');
  });

  it('supports evidence-linked drafts and owned calendar generation', async () => {
    const { service } = setup();
    const record = await service.create(ownerA, consumerDocument);
    const clauseId = record.analysis!.clauses[0]!.clauseId;
    const draft = await service.createDraft(ownerA, record.id, {
      clauseIds: [clauseId],
      recipientRole: 'Billing team',
      tone: 'firm',
      draftType: 'dispute',
    });

    expect(draft.subjectLine).toContain('Dispute');
    expect(draft.sourceClauseIds).toEqual([clauseId]);
    expect(draft.formalLetterDraft).toContain('I request');
    await expect(
      service.createCalendar(ownerB, record.id, {
        confirmedDeadlines: [{ step: 1, deadline: '2026-10-01T00:00:00.000Z' }],
      }),
    ).rejects.toThrow('Document not found.');
  });
});
