import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3QuarantineStorageAdapter } from './s3-quarantine-storage.adapter';

describe('S3QuarantineStorageAdapter.delete', () => {
  const adapter = () => new S3QuarantineStorageAdapter('http://s3.test', 'quarantine', 'us-east-1');
  const mockClient = (storage: S3QuarantineStorageAdapter, send: ReturnType<typeof vi.fn>) => {
    (storage as unknown as { client: Pick<S3Client, 'send'> }).client = { send };
  };

  it('lists every page then erases object versions and delete markers in version-aware batches', async () => {
    const storage = adapter();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        IsTruncated: true,
        Versions: [
          { Key: 'opaque-key', VersionId: 'v1' },
          { Key: 'other-key', VersionId: 'ignore' },
        ],
        DeleteMarkers: [{ Key: 'opaque-key', VersionId: 'd1' }],
        NextKeyMarker: 'opaque-key',
        NextVersionIdMarker: 'd1',
      })
      .mockResolvedValueOnce({
        IsTruncated: false,
        Versions: [{ Key: 'opaque-key', VersionId: 'v2' }],
      })
      .mockResolvedValueOnce({ Errors: [] });
    mockClient(storage, send);

    await storage.delete('opaque-key');

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![0]!).toBeInstanceOf(ListObjectVersionsCommand);
    expect(send.mock.calls[1]![0]!).toBeInstanceOf(ListObjectVersionsCommand);
    const deletion = send.mock.calls[2]![0]! as DeleteObjectsCommand;
    expect(deletion.input.Delete?.Objects).toEqual([
      { Key: 'opaque-key', VersionId: 'v1' },
      { Key: 'opaque-key', VersionId: 'd1' },
      { Key: 'opaque-key', VersionId: 'v2' },
    ]);
  });

  it('does not delete anything when version pagination fails, leaving cleanup retryable', async () => {
    const storage = adapter();
    const send = vi.fn().mockRejectedValueOnce(new Error('S3 unavailable'));
    mockClient(storage, send);

    await expect(storage.delete('opaque-key')).rejects.toThrow('S3 unavailable');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]!).toBeInstanceOf(ListObjectVersionsCommand);
  });

  it('fails completion when S3 reports a failed version deletion', async () => {
    const storage = adapter();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        IsTruncated: false,
        Versions: [{ Key: 'opaque-key', VersionId: 'v1' }],
      })
      .mockResolvedValueOnce({
        Errors: [{ Key: 'opaque-key', VersionId: 'v1', Code: 'AccessDenied' }],
      });
    mockClient(storage, send);

    await expect(storage.delete('opaque-key')).rejects.toThrow('Version deletion failed');
  });
});
