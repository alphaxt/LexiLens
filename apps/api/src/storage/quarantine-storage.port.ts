import type { Readable } from 'node:stream';

export const QUARANTINE_STORAGE_PORT = Symbol('QUARANTINE_STORAGE_PORT');

export interface QuarantineStoragePort {
  put(key: string, stream: Readable): Promise<void>;
  delete(key: string): Promise<void>;
}
