import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';
import type { QuarantineStoragePort } from './quarantine-storage.port';
@Injectable()
export class MemoryQuarantineStorageAdapter implements QuarantineStoragePort {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, stream: Readable) {
    this.assertKey(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.objects.set(key, Buffer.concat(chunks));
  }
  async read(key: string, maxBytes: number) {
    this.assertKey(key);
    const value = this.objects.get(key);
    if (!value) throw new Error('Private object is unavailable.');
    if (value.length > maxBytes) throw new Error('Private object exceeds bounded read limit.');
    return Buffer.from(value);
  }
  /** The in-memory backend has one retained representation per opaque key. */
  async delete(key: string) {
    this.assertKey(key);
    this.objects.delete(key);
  }
  private assertKey(key: string) {
    if (!key || key !== basename(key) || key.includes('..') || key.includes('\\'))
      throw new Error('Invalid private storage key.');
  }
}
