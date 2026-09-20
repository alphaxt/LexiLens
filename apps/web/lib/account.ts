import type { Account, SecurityEvent, UpdatePrivacyPreferences } from '@lexilens/contracts';
import { readApiError, type AuthenticatedFetch } from './auth-transport';

export type AccountExport = {
  exportedAt: string;
  account: Account;
  documents: unknown[];
  securityEvents: SecurityEvent[];
};

export type AccountDeletion = {
  status: 'DELETED';
  purgedDocuments: number;
};

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw await readApiError(response, fallback);
  return (await response.json()) as T;
}

export async function getAccount(fetch: AuthenticatedFetch): Promise<Account> {
  return responseJson(await fetch('/account'), 'Account settings could not be loaded.');
}

export async function updatePrivacy(
  fetch: AuthenticatedFetch,
  preferences: UpdatePrivacyPreferences,
): Promise<Account> {
  return responseJson(
    await fetch('/account/privacy', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preferences),
    }),
    'Privacy settings could not be saved.',
  );
}

export async function getAuditLog(fetch: AuthenticatedFetch): Promise<SecurityEvent[]> {
  return responseJson(await fetch('/account/audit-log'), 'Audit events could not be loaded.');
}

export async function exportAccount(fetch: AuthenticatedFetch): Promise<AccountExport> {
  return responseJson(await fetch('/account/export'), 'Account export could not be created.');
}

export async function deleteAccount(fetch: AuthenticatedFetch): Promise<AccountDeletion> {
  return responseJson(
    await fetch('/account', { method: 'DELETE' }),
    'Account deletion could not be completed. No data was removed.',
  );
}

export const deletionConfirmation = 'DELETE MY ACCOUNT';

export function canDeleteAccount(confirmation: string): boolean {
  return confirmation.trim() === deletionConfirmation;
}

export function auditEventLabel(type: SecurityEvent['type']): string {
  const labels: Record<SecurityEvent['type'], string> = {
    ACCOUNT_INITIALIZED: 'Account initialized',
    PRIVACY_UPDATED: 'Privacy settings updated',
    DATA_EXPORTED: 'Account export created',
    ACCOUNT_DELETED: 'Account deleted',
  };
  return labels[type];
}

export function saveAccountExport(exportData: AccountExport): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }),
  );
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `lexilens-account-export-${exportData.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
