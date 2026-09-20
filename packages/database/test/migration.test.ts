import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATABASE_SCHEMA_VERSION } from '../src/index';

const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve('prisma/migrations/20260920000000_initial/migration.sql'),
  'utf8',
);

describe('initial PostgreSQL migration', () => {
  it('tracks the checked-in migration as the exported schema version', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe('20260921000000_add_document_upload_quarantine');
  });

  it('creates every model and enum represented by the Prisma schema', () => {
    for (const model of ['Owner', 'Account', 'Document', 'SecurityEvent']) {
      expect(schema).toContain(`model ${model}`);
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
    for (const type of ['DocumentStatus', 'RetentionPolicy', 'SecurityEventType', 'ActorMode']) {
      expect(schema).toContain(`enum ${type}`);
      expect(migration).toContain(`CREATE TYPE "${type}" AS ENUM`);
    }
  });

  it('enforces active owner/hash uniqueness, ordered events, and cascading erasure', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "Document_ownerId_activeContentHash_key"');
    expect(migration).toContain('CREATE INDEX "SecurityEvent_ownerId_sequence_idx"');
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(3);
    expect(migration).not.toMatch(/sourceText.*SecurityEvent|payload|content.*SecurityEvent/i);
  });
});
