import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedFetch } from './auth-transport';
import { publicAuthConfig } from './auth-config';

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('authenticated transport', () => {
  it('uses only the local development header in local mode', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    await createAuthenticatedFetch(() => '00000000-0000-4000-8000-000000000000', vi.fn(), {
      ...publicAuthConfig,
      mode: 'local',
      apiUrl: 'http://localhost:4000',
    })('/documents');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/documents',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .headers as Headers;
    expect(headers.get('x-local-session-id')).toBeTruthy();
    expect(headers.get('authorization')).toBeNull();
  });
  it('uses a bearer token only in OIDC mode', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    await createAuthenticatedFetch(() => 'access-token', vi.fn(), {
      ...publicAuthConfig,
      mode: 'oidc',
    })('/documents');
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer access-token');
    expect(headers.get('x-local-session-id')).toBeNull();
  });

  it('clears state on 401 and does not retry 403', async () => {
    const clear = vi.fn();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    );
    await expect(
      createAuthenticatedFetch(() => 'session', clear)('/documents'),
    ).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 403 }),
    );
    await expect(
      createAuthenticatedFetch(() => 'session', clear)('/documents'),
    ).rejects.toMatchObject({ status: 403 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
