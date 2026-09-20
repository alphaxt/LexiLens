import { Inject, Injectable } from '@nestjs/common';
import { loadConfig } from './config';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';

/** Internal worker entry point for a deployment queue/scheduler; it exposes no document contents. */
@Injectable()
export class ExtractionWorkerService {
  private readonly config = loadConfig();

  constructor(@Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort) {}

  async reconcileExpiredLeases() {
    return this.persistence.reconcileExpiredExtractionLeases(
      this.config.EXTRACTION_MAX_ATTEMPTS,
      this.config.EXTRACTION_RECONCILIATION_BATCH_SIZE,
    );
  }
}
