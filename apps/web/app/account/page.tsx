'use client';

import type { Account } from '@lexilens/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth-provider';
import { publicAuthConfig } from '../../lib/auth-config';
import {
  auditEventLabel,
  canDeleteAccount,
  deletionConfirmation,
  deleteAccount,
  exportAccount,
  getAccount,
  getAuditLog,
  saveAccountExport,
  updatePrivacy,
} from '../../lib/account';

const CONSENT_POLICY_VERSION = '2026-01';
const retentionOptions: ReadonlyArray<{
  value: Account['privacy']['retentionPolicy'];
  label: string;
}> = [
  { value: 'SESSION', label: 'Session only' },
  { value: '7_DAYS', label: '7 days' },
  { value: '30_DAYS', label: '30 days' },
  { value: '90_DAYS', label: '90 days' },
];

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export default function AccountPage() {
  const {
    authenticatedFetch,
    error: authError,
    identity,
    isAuthenticated,
    logout,
    ready,
  } = useAuth();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getAuditLog>>>([]);
  const [retentionPolicy, setRetentionPolicy] =
    useState<Account['privacy']['retentionPolicy']>('SESSION');
  const [acceptConsent, setAcceptConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let active = true;
    setLoading(true);
    Promise.all([getAccount(authenticatedFetch), getAuditLog(authenticatedFetch)])
      .then(([loadedAccount, loadedEvents]) => {
        if (!active) return;
        setAccount(loadedAccount);
        setRetentionPolicy(loadedAccount.privacy.retentionPolicy);
        setEvents(loadedEvents);
      })
      .catch(
        (caught: unknown) =>
          active && setError(messageFor(caught, 'Account settings could not be loaded.')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [authenticatedFetch, isAuthenticated, ready]);

  async function savePrivacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const changedRetention = retentionPolicy !== account.privacy.retentionPolicy;
    if (!changedRetention && !acceptConsent) {
      setNotice('Choose a new retention period or accept the policy before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updatePrivacy(authenticatedFetch, {
        ...(changedRetention ? { retentionPolicy } : {}),
        ...(acceptConsent ? { acceptConsentVersion: CONSENT_POLICY_VERSION } : {}),
      });
      setAccount(updated);
      setRetentionPolicy(updated.privacy.retentionPolicy);
      setAcceptConsent(false);
      setEvents(await getAuditLog(authenticatedFetch));
      setNotice('Privacy settings saved.');
    } catch (caught) {
      setError(messageFor(caught, 'Privacy settings could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function downloadExport() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      saveAccountExport(await exportAccount(authenticatedFetch));
      setEvents(await getAuditLog(authenticatedFetch));
      setNotice('Your complete account export is downloading.');
    } catch (caught) {
      setError(messageFor(caught, 'Account export could not be created.'));
    } finally {
      setExporting(false);
    }
  }

  async function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDeleteAccount(confirmation)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount(authenticatedFetch);
      setAccount(null);
      setEvents([]);
      setConfirmation('');
      await logout();
      router.replace('/');
    } catch (caught) {
      setError(messageFor(caught, 'Account deletion could not be completed. No data was removed.'));
      setDeleting(false);
    }
  }

  if (!ready || loading) {
    return (
      <main className="auth-screen">
        <h1>Loading account settings</h1>
      </main>
    );
  }
  if (!isAuthenticated) {
    return (
      <main className="auth-screen">
        <div>
          <h1>Session expired</h1>
          <p>Sign in again to view account settings.</p>
          <Link href="/">Return to workspace</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="account-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="LexiLens workspace">
          <span aria-hidden>◈</span> LexiLens
        </Link>
        <div className="account">
          <span>
            {publicAuthConfig.mode === 'oidc'
              ? (identity ?? 'Signed-in account')
              : 'Local development session'}
          </span>
          <Link className="secondary compact" href="/">
            Workspace
          </Link>
        </div>
      </header>
      <section className="account-hero" aria-labelledby="account-title">
        <p className="eyebrow">Account & privacy</p>
        <h1 id="account-title">Control your account data</h1>
        <p className="lede">
          Mode:{' '}
          <strong>
            {publicAuthConfig.mode === 'oidc' ? 'Organization sign-in (OIDC)' : 'Local development'}
          </strong>
          .{' '}
          {publicAuthConfig.mode === 'oidc'
            ? 'Your identity is shown only for this session.'
            : 'This browser uses an anonymous local session for development.'}
        </p>
      </section>
      {(error || authError) && (
        <p className="error" role="alert">
          {error ?? authError}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {account && (
        <div className="account-grid">
          <section className="settings-card" aria-labelledby="privacy-title">
            <p className="eyebrow">Privacy preferences</p>
            <h2 id="privacy-title">Retention and consent</h2>
            <form onSubmit={savePrivacy}>
              <label htmlFor="retention">Document retention</label>
              <select
                id="retention"
                value={retentionPolicy}
                onChange={(event) =>
                  setRetentionPolicy(event.target.value as Account['privacy']['retentionPolicy'])
                }
              >
                {retentionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Saved setting: {account.privacy.retentionPolicy.replace('_', ' ').toLowerCase()}.
                Choosing an option does not save it.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={acceptConsent}
                  onChange={(event) => setAcceptConsent(event.target.checked)}
                />{' '}
                I accept the privacy policy, version {CONSENT_POLICY_VERSION}.
              </label>
              <p className="field-help">
                {account.privacy.consentAccepted
                  ? `Accepted version ${account.privacy.consentVersion} on ${new Date(account.privacy.consentedAt ?? '').toLocaleString()}.`
                  : 'Not yet accepted.'}
              </p>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save privacy settings'}
              </button>
            </form>
          </section>
          <section className="settings-card" aria-labelledby="export-title">
            <p className="eyebrow">Data portability</p>
            <h2 id="export-title">Complete account export</h2>
            <p>
              Download your account data and document records as JSON. The download is only created
              when you select this action; credentials are never included.
            </p>
            <button type="button" onClick={() => void downloadExport()} disabled={exporting}>
              {exporting ? 'Preparing export…' : 'Download complete export'}
            </button>
          </section>
          <section className="settings-card" aria-labelledby="audit-title">
            <p className="eyebrow">Security history</p>
            <h2 id="audit-title">Account audit events</h2>
            <p className="field-help">
              This list contains account actions only—never document or source content.
            </p>
            <ul className="audit-list">
              {events.length ? (
                events.map((item) => (
                  <li key={item.id}>
                    <strong>{auditEventLabel(item.type)}</strong>
                    <span>
                      {new Date(item.occurredAt).toLocaleString()} · {item.actorMode}
                    </span>
                  </li>
                ))
              ) : (
                <li>No account events yet.</li>
              )}
            </ul>
          </section>
          <section className="settings-card danger-card" aria-labelledby="delete-title">
            <p className="eyebrow">Irreversible action</p>
            <h2 id="delete-title">Delete account</h2>
            <p>
              Deleting your account purges your documents and account data from the current backend.
              This cannot be undone.
            </p>
            <p>
              {publicAuthConfig.mode === 'oidc'
                ? 'We will clear this browser session and ask your identity provider to sign out. Provider sign-out may need to complete in a separate browser flow.'
                : 'We will clear this browser’s local session. Reload only when you are ready to begin a fresh local workspace.'}
            </p>
            <form onSubmit={confirmDeletion}>
              <label htmlFor="delete-confirmation">
                Type <strong>{deletionConfirmation}</strong> to confirm
              </label>
              <input
                id="delete-confirmation"
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <button
                type="submit"
                className="danger"
                disabled={!canDeleteAccount(confirmation) || deleting}
              >
                {deleting ? 'Deleting account…' : 'Permanently delete account'}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
