import { Injectable } from '@nestjs/common';
import { CleanupReconcilerService } from './cleanup-reconciler.service';
import { ExtractionWorkerService } from './extraction-worker.service';

/** Executes bounded maintenance once; intended for a scheduled internal task, never HTTP. */
@Injectable()
export class MaintenanceWorkerService {
  constructor(
    private readonly cleanup: CleanupReconcilerService,
    private readonly extraction: ExtractionWorkerService,
  ) {}

  async runOnce() {
    const [cleanup, extractionLeases] = await Promise.all([
      this.cleanup.reconcile(),
      this.extraction.reconcileExpiredLeases(),
    ]);
    return { cleanup, extractionLeases };
  }
}
