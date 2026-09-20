import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { QuarantineStoragePort } from './quarantine-storage.port';
/** Private S3-compatible boundary. It never derives object keys from filenames or produces URLs. */
export class S3QuarantineStorageAdapter implements QuarantineStoragePort {
  private readonly client: S3Client;
  constructor(
    endpoint: string,
    private readonly bucket: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  async put(key: string, stream: Readable) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: stream }));
  }
  async read(key: string, maxBytes: number) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Private object is unavailable.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of result.Body as AsyncIterable<Uint8Array>) {
      size += value.length;
      if (size > maxBytes) throw new Error('Private object exceeds bounded read limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
