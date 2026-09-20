export { PrismaPg } from '@prisma/adapter-pg';
export { Prisma, PrismaClient } from '@prisma/client';
export type { Account, Document, Owner, SecurityEvent } from '@prisma/client';

export type PersistenceMode = 'memory' | 'postgresql';

export const DATABASE_SCHEMA_VERSION = '20260922000000_add_extraction_worker';
