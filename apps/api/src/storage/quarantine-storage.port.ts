import type { Readable } from 'node:stream';
export const QUARANTINE_STORAGE_PORT = Symbol('QUARANTINE_STORAGE_PORT');
/** Internal-only opaque-object boundary; no route exposes keys or content. */
export interface QuarantineStoragePort {
  put(key: string, stream: Readable): Promise<void>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
