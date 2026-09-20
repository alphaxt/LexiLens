import { describe, expect, it } from 'vitest';
import { BoundedSessionStateStore } from './oidc';

function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  } as Storage;
}
describe('OIDC PKCE transaction store', () => {
  it('keeps epoch-second OIDC transactions in session storage, expires them, and rejects replay after removal', async () => {
    const session = storage();
    const store = new BoundedSessionStateStore(session, () => 1_000);
    await store.set('state', JSON.stringify({ created: 900, nonce: 'n', code_verifier: 'v' }));
    expect(await store.get('state')).toContain('code_verifier');
    await store.remove('state');
    expect(await store.get('state')).toBeNull();
    await store.set('old', JSON.stringify({ created: 399 }));
    expect(await store.get('old')).toBeNull();
  });
  it('bounds outstanding authorization transactions', async () => {
    const store = new BoundedSessionStateStore(storage(), () => 1_000);
    for (let index = 0; index < 6; index++)
      await store.set(String(index), JSON.stringify({ created: 1_000 }));
    expect((await store.getAllKeys()).length).toBe(5);
  });
});
