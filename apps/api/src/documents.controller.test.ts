import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthController } from './documents.controller';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';

class UnhealthyPersistenceAdapter extends MemoryPersistenceAdapter {
  override async health() {
    return {
      healthy: false,
      mode: 'postgresql' as const,
      schemaVersion: '20260921000000_add_document_upload_quarantine',
    };
  }
}

describe('HealthController readiness', () => {
  it('reports the active persistence mode and schema version', async () => {
    const controller = new HealthController(new MemoryPersistenceAdapter());
    await expect(controller.status()).resolves.toMatchObject({
      status: 'ok',
      service: 'lexilens-api',
      persistence: {
        mode: 'memory',
        schemaVersion: '20260922000000_add_extraction_worker',
      },
    });
  });

  it('fails readiness without exposing a database URL', async () => {
    const controller = new HealthController(new UnhealthyPersistenceAdapter());
    await expect(controller.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
    try {
      await controller.status();
    } catch (error) {
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
        'DATABASE_URL',
      );
    }
  });
});
