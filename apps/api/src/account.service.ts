import { Inject, Injectable } from '@nestjs/common';
import type { Account, SecurityEvent, UpdatePrivacyPreferences } from '@lexilens/contracts';
import type { AuthPrincipal } from './auth/identity';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';

@Injectable()
export class AccountService {
  constructor(@Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort) {}

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
    return this.persistence.deleteOwner(principal);
  }

  async auditLog(principal: AuthPrincipal): Promise<SecurityEvent[]> {
    return this.persistence.listSecurityEvents(principal.ownerId);
  }
}
