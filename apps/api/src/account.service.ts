import { Inject, Injectable } from '@nestjs/common';
import type { Account, SecurityEvent, UpdatePrivacyPreferences } from '@lexilens/contracts';
import type { AuthPrincipal } from './auth/identity';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';
import {
  QUARANTINE_STORAGE_PORT,
  type QuarantineStoragePort,
} from './storage/quarantine-storage.port';

@Injectable()
export class AccountService {
  constructor(
    @Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort,
    @Inject(QUARANTINE_STORAGE_PORT)
    private readonly storage: QuarantineStoragePort = {
      put: async () => undefined,
      delete: async () => undefined,
    },
  ) {}

  async get(principal: AuthPrincipal): Promise<Account> {
    return this.persistence.getOrCreateAccount(principal);
  }

  async update(principal: AuthPrincipal, input: UpdatePrivacyPreferences): Promise<Account> {
    return this.persistence.updatePrivacy(principal, input);
  }

  async export(principal: AuthPrincipal) {
    return this.persistence.exportAccount(principal);
  }

  async delete(principal: AuthPrincipal): Promise<{ status: 'DELETED'; purgedDocuments: number }> {
    const keys = await this.persistence.listStorageKeys(principal.ownerId);
    // Deletion is idempotent; retain the database owner when storage is unavailable so a retry can reconcile it.
    await Promise.all(keys.map((key) => this.storage.delete(key)));
    return this.persistence.deleteOwner(principal);
  }

  async auditLog(principal: AuthPrincipal): Promise<SecurityEvent[]> {
    return this.persistence.listSecurityEvents(principal.ownerId);
  }
}
