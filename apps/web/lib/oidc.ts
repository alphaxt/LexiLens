import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { publicAuthConfig } from './auth-config';

const TRANSACTION_PREFIX = 'lexilens.oidc.transaction.';
const MAX_TRANSACTIONS = 5;
const MAX_TRANSACTION_AGE_SECONDS = 10 * 60;

export class BoundedSessionStateStore {
  constructor(
    private readonly storage: Storage,
    private readonly now = () => Math.floor(Date.now() / 1000),
  ) {}
  async set(key: string, value: string): Promise<void> {
    this.removeExpired();
    const keys = this.keys();
    while (keys.length >= MAX_TRANSACTIONS) this.storage.removeItem(keys.shift()!);
    this.storage.setItem(`${TRANSACTION_PREFIX}${key}`, value);
  }
  async get(key: string): Promise<string | null> {
    const storageKey = `${TRANSACTION_PREFIX}${key}`;
    const value = this.storage.getItem(storageKey);
    if (!value) return null;
    try {
      const created = JSON.parse(value).created;
      if (typeof created !== 'number' || this.now() - created > MAX_TRANSACTION_AGE_SECONDS) {
        this.storage.removeItem(storageKey);
        return null;
      }
    } catch {
      this.storage.removeItem(storageKey);
      return null;
    }
    return value;
  }
  async remove(key: string): Promise<string | null> {
    const storageKey = `${TRANSACTION_PREFIX}${key}`;
    const value = this.storage.getItem(storageKey);
    this.storage.removeItem(storageKey);
    return value;
  }
  async getAllKeys(): Promise<string[]> {
    this.removeExpired();
    return this.keys().map((key) => key.slice(TRANSACTION_PREFIX.length));
  }
  private keys(): string[] {
    return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
      .filter((key): key is string => key?.startsWith(TRANSACTION_PREFIX) ?? false)
      .sort();
  }
  private removeExpired(): void {
    for (const key of this.keys()) {
      try {
        const created = JSON.parse(this.storage.getItem(key) ?? '').created;
        if (typeof created !== 'number' || this.now() - created > MAX_TRANSACTION_AGE_SECONDS)
          this.storage.removeItem(key);
      } catch {
        this.storage.removeItem(key);
      }
    }
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let manager: UserManager | undefined;
export function getOidcManager(): UserManager {
  if (publicAuthConfig.mode !== 'oidc') throw new Error('OIDC is not enabled.');
  if (!manager)
    manager = new UserManager({
      authority: publicAuthConfig.issuer!,
      client_id: publicAuthConfig.clientId!,
      redirect_uri: publicAuthConfig.redirectUri!,
      post_logout_redirect_uri: publicAuthConfig.postLogoutUri!,
      response_type: 'code',
      scope: publicAuthConfig.scope!,
      extraQueryParams: { audience: publicAuthConfig.audience! },
      stateStore: new BoundedSessionStateStore(window.sessionStorage),
      userStore: new WebStorageStateStore({ store: new MemoryStorage() }),
      automaticSilentRenew: false,
      monitorSession: false,
      loadUserInfo: false,
    });
  return manager;
}
export function safeIdentity(user: User): string {
  return (
    user.profile.name ??
    user.profile.preferred_username ??
    user.profile.email ??
    user.profile.sub ??
    'Signed-in user'
  );
}
