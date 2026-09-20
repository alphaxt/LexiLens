import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { QuarantineStoragePort } from './quarantine-storage.port';

/** Private S3-compatible boundary. It never derives object keys from filenames or produces URLs. */
export class S3QuarantineStorageAdapter implements QuarantineStoragePort {
  private static readonly maxVersionPages = 1_000;
  private static readonly deleteBatchSize = 1_000;
  private readonly client: S3Client;
  constructor(
    endpoint: string,
    private readonly bucket: string,
    region: string,
    accessKeyId?: string,
    secretAccessKey?: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
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
  /**
   * Physically erases every version and delete marker for one opaque key. Listing completes before
   * any deletion, so a failed page or batch leaves the durable cleanup task retryable.
   */
  async delete(key: string) {
    const versions: ObjectIdentifier[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    for (let page = 0; page < S3QuarantineStorageAdapter.maxVersionPages; page += 1) {
      const result = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
          MaxKeys: S3QuarantineStorageAdapter.deleteBatchSize,
        }),
      );
      for (const entry of [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]) {
        if (entry.Key === key && entry.VersionId)
          versions.push({ Key: key, VersionId: entry.VersionId });
      }
      if (!result.IsTruncated) break;
      if (!result.NextKeyMarker || !result.NextVersionIdMarker)
        throw new Error('Version listing was truncated without a continuation marker.');
      keyMarker = result.NextKeyMarker;
      versionIdMarker = result.NextVersionIdMarker;
      if (page === S3QuarantineStorageAdapter.maxVersionPages - 1)
        throw new Error('Version listing exceeded the bounded cleanup page limit.');
    }

    for (
      let index = 0;
      index < versions.length;
      index += S3QuarantineStorageAdapter.deleteBatchSize
    ) {
      const Objects = versions.slice(index, index + S3QuarantineStorageAdapter.deleteBatchSize);
      const result = await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects, Quiet: true } }),
      );
      if (result.Errors?.length)
        throw new Error(`Version deletion failed for ${result.Errors.length} object version(s).`);
    }
  }
}
