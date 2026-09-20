import { describe, expect, it } from 'vitest';
import { auditSchema, createDocumentSchema, sourceEvidenceSchema } from './index.js';

const validEvidence = {
  pageNumber: null,
  startOffset: 2,
  endOffset: 5,
  excerpt: 'terms',
  confidence: 0.9,
};

describe('LexiLens contracts', () => {
  it('rejects evidence whose end precedes its start', () => {
    expect(() => sourceEvidenceSchema.parse({ ...validEvidence, endOffset: 1 })).toThrow(
      'Evidence end offset',
    );
  });

  it('accepts valid raw-text evidence without synthetic page metadata', () => {
    expect(sourceEvidenceSchema.parse(validEvidence)).toEqual(validEvidence);
  });

  it('enforces the absolute text-ingestion safety limit', () => {
    expect(() => createDocumentSchema.parse({ title: 'A', text: 'x'.repeat(1_000_001) })).toThrow();
  });

  it('rejects misleading PDF metadata on the text-only ingestion contract', () => {
    expect(() =>
      createDocumentSchema.parse({ title: 'A', text: 'terms', mimeType: 'application/pdf' }),
    ).toThrow();
  });

  it('requires transparent calculation data in a completed audit', () => {
    expect(() => auditSchema.parse({})).toThrow();
  });
});

describe('privacy contracts', () => {
  it('requires an explicit preference change', async () => {
    const { updatePrivacyPreferencesSchema } = await import('./index.js');
    expect(() => updatePrivacyPreferencesSchema.parse({})).toThrow('At least one');
  });

  it('accepts bounded consent versions and retention policies', async () => {
    const { updatePrivacyPreferencesSchema } = await import('./index.js');
    expect(
      updatePrivacyPreferencesSchema.parse({
        retentionPolicy: '30_DAYS',
        acceptConsentVersion: 'privacy-2026-09',
      }),
    ).toEqual({ retentionPolicy: '30_DAYS', acceptConsentVersion: 'privacy-2026-09' });
  });
});
