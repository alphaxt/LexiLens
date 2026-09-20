import type { DocumentRecord } from '@lexilens/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_FILE_BYTES,
  mergeDocumentHistory,
  removeFromDocumentHistory,
  validateTextFile,
} from './workspace';

function record(id: string, updatedAt: string, status: DocumentRecord['status'] = 'COMPLETED') {
  return { id, updatedAt, status } as DocumentRecord;
}

describe('document workspace', () => {
  it('accepts only non-empty bounded plain-text files', () => {
    expect(validateTextFile({ name: 'terms.txt', type: 'text/plain', size: 100 })).toBeNull();
    expect(validateTextFile({ name: 'terms.pdf', type: 'application/pdf', size: 100 })).toContain(
      '.txt',
    );
    expect(validateTextFile({ name: 'empty.txt', type: 'text/plain', size: 0 })).toContain('empty');
    expect(
      validateTextFile({ name: 'large.txt', type: 'text/plain', size: MAX_TEXT_FILE_BYTES + 1 }),
    ).toContain('exceeds');
  });

  it('deduplicates and sorts refreshed documents by latest update', () => {
    const result = mergeDocumentHistory(
      [record('a', '2026-01-01T00:00:00.000Z'), record('b', '2026-02-01T00:00:00.000Z')],
      record('a', '2026-03-01T00:00:00.000Z'),
    );
    expect(result.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('removes a deleted document from local history', () => {
    expect(
      removeFromDocumentHistory(
        [record('a', '2026-01-01T00:00:00.000Z'), record('b', '2026-01-01T00:00:00.000Z')],
        'a',
      ).map(({ id }) => id),
    ).toEqual(['b']);
  });
});
