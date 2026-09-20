import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedFetch } from './auth-transport';
import {
  auditEventLabel,
  canDeleteAccount,
  deleteAccount,
  deletionConfirmation,
  exportAccount,
  getAccount,
  getAuditLog,
  updatePrivacy,
} from './account';

function fetchWith(response: Response): AuthenticatedFetch {
  return vi.fn().mockResolvedValue(response) as unknown as AuthenticatedFetch;
}

describe('account API client', () => {
  it('uses the injected authenticated transport for all account operations', async () => {
    const account = { privacy: { retentionPolicy: 'SESSION' } };
    const fetch = fetchWith(new Response(JSON.stringify(account), { status: 200 }));
    await getAccount(fetch);
    expect(fetch).toHaveBeenCalledWith('/account');

    const updateFetch = fetchWith(new Response(JSON.stringify(account), { status: 200 }));
    await updatePrivacy(updateFetch, { retentionPolicy: '30_DAYS' });
    expect(updateFetch).toHaveBeenCalledWith(
      '/account/privacy',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(JSON.parse((updateFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body)).toEqual({
      retentionPolicy: '30_DAYS',
    });

    const auditFetch = fetchWith(new Response('[]', { status: 200 }));
    await getAuditLog(auditFetch);
    expect(auditFetch).toHaveBeenCalledWith('/account/audit-log');

    const exportFetch = fetchWith(
      new Response(JSON.stringify({ documents: [], securityEvents: [] }), { status: 200 }),
    );
    await exportAccount(exportFetch);
    expect(exportFetch).toHaveBeenCalledWith('/account/export');

    const deletionFetch = fetchWith(
      new Response(JSON.stringify({ status: 'DELETED', purgedDocuments: 2 }), { status: 200 }),
    );
    await deleteAccount(deletionFetch);
    expect(deletionFetch).toHaveBeenCalledWith('/account', { method: 'DELETE' });
  });

  it('preserves authentication errors from the transport', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new Error('Your session has expired. Please sign in again.'),
      ) as unknown as AuthenticatedFetch;
    await expect(getAccount(fetch)).rejects.toThrow('expired');
  });

  it('requires an exact typed deletion confirmation and safe audit labels', () => {
    expect(canDeleteAccount(deletionConfirmation)).toBe(true);
    expect(canDeleteAccount('delete my account')).toBe(false);
    expect(auditEventLabel('PRIVACY_UPDATED')).toBe('Privacy settings updated');
  });
});
