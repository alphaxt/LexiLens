import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';
import type { QuarantineStoragePort } from './quarantine-storage.port';

@Injectable()
export class MemoryQuarantineStorageAdapter implements QuarantineStoragePort {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, stream: Readable): Promise<void> {
    this.assertKey(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.objects.set(key, Buffer.concat(chunks));
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    this.objects.delete(key);
  }

  private assertKey(key: string): void {
    if (!key || key !== basename(key) || key.includes('..') || key.includes('\\')) {
      throw new Error('Invalid private storage key.');
    }
  }
}
