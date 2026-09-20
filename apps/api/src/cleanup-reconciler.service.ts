import { Inject, Injectable } from '@nestjs/common';
import {
  PERSISTENCE_PORT,
  type CleanupReconciliationResult,
  type PersistencePort,
} from './persistence/persistence.port';
import {
  QUARANTINE_STORAGE_PORT,
  type QuarantineStoragePort,
} from './storage/quarantine-storage.port';

/** Bounded internal worker: it emits counts only and never reads or exposes object content/keys. */
@Injectable()
export class CleanupReconcilerService {
  private static readonly batchSize = 50;
  private static readonly leaseMs = 60_000;
  private static readonly retryAfterMs = 60_000;
  constructor(
    @Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort,
    @Inject(QUARANTINE_STORAGE_PORT) private readonly storage: QuarantineStoragePort,
  ) {}
  async reconcile(): Promise<CleanupReconciliationResult> {
    const expired = await this.persistence.enqueueExpiredRetention(
      CleanupReconcilerService.batchSize,
    );
    const tasks = await this.persistence.claimCleanupTasks(
      CleanupReconcilerService.batchSize,
      CleanupReconcilerService.leaseMs,
    );
    let deleted = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        await this.storage.delete(task.objectKey);
        await this.persistence.completeCleanupTask(task);
        deleted += 1;
      } catch {
        await this.persistence.failCleanupTask(
          task,
          'OBJECT_DELETE_FAILED',
          CleanupReconcilerService.retryAfterMs,
        );
        failed += 1;
      }
    }
    const accountsFinalized = await this.persistence.finalizeDeletedAccounts();
    return { claimed: tasks.length, deleted, failed, expired, accountsFinalized };
  }
}
