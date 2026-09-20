import { describe, expect, it, vi } from 'vitest';
import { MaintenanceWorkerService } from './maintenance-worker.service';

describe('MaintenanceWorkerService', () => {
  it('runs cleanup and expired-lease reconciliation once and returns only their summaries', async () => {
    const cleanup = { reconcile: vi.fn().mockResolvedValue({ deleted: 2, failed: 0 }) } as any;
    const extraction = {
      reconcileExpiredLeases: vi.fn().mockResolvedValue({ reconciled: 3 }),
    } as any;
    const worker = new MaintenanceWorkerService(cleanup, extraction);

    await expect(worker.runOnce()).resolves.toEqual({
      cleanup: { deleted: 2, failed: 0 },
      extractionLeases: { reconciled: 3 },
    });
    expect(cleanup.reconcile).toHaveBeenCalledOnce();
    expect(extraction.reconcileExpiredLeases).toHaveBeenCalledOnce();
  });
});
