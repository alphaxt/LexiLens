'use client';

import type { Clause, DocumentRecord } from '@lexilens/contracts';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { publicAuthConfig } from '../lib/auth-config';
import { riskLabel, sliceSource } from '../lib/presentation';
import {
  mergeDocumentHistory,
  removeFromDocumentHistory,
  validateTextFile,
} from '../lib/workspace';

const API_URL = '';
const SAMPLE = `SERVICE MEMBERSHIP TERMS\n\nYour membership will automatically renew for another twelve-month term unless you provide written notice 30 days before the renewal date.\n\nA $75 late fee may be assessed for each late payment. The Company may modify these terms at any time in its sole discretion.\n\nAll disputes must be resolved by binding arbitration. You waive the right to bring or join a class action.`;

type DraftType = 'counter-proposal' | 'dispute';
type DraftTone = 'collaborative' | 'firm';

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const {
    authenticatedFetch,
    error: authError,
    identity,
    isAuthenticated,
    login,
    logout,
    ready,
  } = useAuth();
  const fetch = authenticatedFetch;
  const [title, setTitle] = useState('Membership agreement');
  const [text, setText] = useState(SAMPLE);
  const [documentRecord, setDocumentRecord] = useState<DocumentRecord | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<DraftType>('counter-proposal');
  const [draftTone, setDraftTone] = useState<DraftTone>('collaborative');
  const [recipientRole, setRecipientRole] = useState('Account representative');
  const [confirmedDate, setConfirmedDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const evidenceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    setHistoryBusy(true);
    fetch(`${API_URL}/documents`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Document history could not be loaded.');
        return (await response.json()) as DocumentRecord[];
      })
      .then(setDocuments)
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error ? caught.message : 'Document history could not be loaded.',
        );
      })
      .finally(() => setHistoryBusy(false));
  }, [fetch, isAuthenticated, ready]);

  const analysis = documentRecord?.analysis ?? null;
  const selected = analysis?.clauses.find((clause) => clause.clauseId === selectedClauseId) ?? null;
  const selectedRange: readonly [number, number] | null = selected
    ? [selected.evidence.startOffset, selected.evidence.endOffset]
    : null;
  const source = sliceSource(documentRecord?.sourceText ?? '', selectedRange);
  const trapCount = analysis?.clauses.filter((clause) => clause.riskLevel === 'TRAP').length ?? 0;
  const cautionCount =
    analysis?.clauses.filter((clause) => clause.riskLevel === 'CAUTION').length ?? 0;

  function headers(withJson = false): HeadersInit {
    return withJson ? { 'content-type': 'application/json' } : {};
  }

  function openDocument(record: DocumentRecord) {
    setDocumentRecord(record);
    setSelectedClauseId(record.analysis?.clauses[0]?.clauseId ?? null);
    setSelectedClauseIds([]);
    setDraft(null);
    setError(null);
  }

  async function refreshDocuments() {
    if (!isAuthenticated) return;
    setHistoryBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/documents`, { headers: headers() });
      if (!response.ok) throw new Error('Document history could not be refreshed.');
      setDocuments((await response.json()) as DocumentRecord[]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Document history could not be refreshed.',
      );
    } finally {
      setHistoryBusy(false);
    }
  }

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = validateTextFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      const importedText = await file.text();
      if (!importedText.trim())
        throw new Error('The selected text file contains no readable text.');
      setTitle(file.name.replace(/\.txt$/i, ''));
      setText(importedText);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The text file could not be read.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const response = await fetch(`${API_URL}/documents`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ title, text, mimeType: 'text/plain' }),
      });
      if (!response.ok) throw new Error('The document could not be screened.');
      const result = (await response.json()) as DocumentRecord;
      setDocumentRecord(result);
      setDocuments((current) => mergeDocumentHistory(current, result));
      setSelectedClauseId(result.analysis?.clauses[0]?.clauseId ?? null);
      setSelectedClauseIds([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  }

  function chooseClause(clause: Clause) {
    setSelectedClauseId(clause.clauseId);
    window.setTimeout(
      () => evidenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      0,
    );
  }

  function toggleClause(clauseId: string) {
    setSelectedClauseIds((current) =>
      current.includes(clauseId) ? current.filter((id) => id !== clauseId) : [...current, clauseId],
    );
  }

  async function generateDraft() {
    if (!documentRecord || !selectedClauseIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/documents/${documentRecord.id}/drafts`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({
          clauseIds: selectedClauseIds,
          recipientRole,
          tone: draftTone,
          draftType,
        }),
      });
      if (!response.ok) throw new Error('The draft could not be generated.');
      const result = (await response.json()) as { formalLetterDraft: string };
      setDraft(result.formalLetterDraft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  }

  async function exportCalendar() {
    const item = analysis?.timelineChecklist[0];
    if (!documentRecord || !item || !confirmedDate) return;
    const deadline = new Date(`${confirmedDate}T12:00:00.000Z`).toISOString();
    const response = await fetch(`${API_URL}/documents/${documentRecord.id}/calendar`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ confirmedDeadlines: [{ step: item.step, deadline }] }),
    });
    if (!response.ok) {
      setError('The calendar could not be exported.');
      return;
    }
    saveBlob(await response.blob(), 'lexilens-deadlines.ics');
  }

  function exportData() {
    if (!documentRecord) return;
    saveBlob(
      new Blob([JSON.stringify(documentRecord, null, 2)], { type: 'application/json' }),
      'lexilens-audit.json',
    );
  }

  async function deleteDocument() {
    if (!documentRecord) return;
    const response = await fetch(`${API_URL}/documents/${documentRecord.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!response.ok) {
      setError('The local document could not be deleted.');
      return;
    }
    setDocuments((current) => removeFromDocumentHistory(current, documentRecord.id));
    setDocumentRecord(null);
    setSelectedClauseId(null);
    setDraft(null);
    setSelectedClauseIds([]);
  }

  if (!ready)
    return (
      <main className="auth-screen">
        <h1>Loading secure workspace</h1>
      </main>
    );
  if (publicAuthConfig.mode === 'oidc' && !isAuthenticated) {
    return (
      <main className="auth-screen">
        <div>
          <p className="eyebrow">Secure workspace</p>
          <h1>Sign in to LexiLens</h1>
          <p>Use your organization account to access your document workspace.</p>
          <button onClick={() => void login()}>Sign in</button>
          {authError && (
            <p className="error" role="alert">
              {authError}
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <div className="brand" aria-label="LexiLens home">
          <span aria-hidden>◈</span> LexiLens
        </div>
        {publicAuthConfig.mode === 'oidc' ? (
          <div className="account">
            <span>{identity}</span>
            <button className="secondary compact" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        ) : (
          <p>Local development demo</p>
        )}
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Consumer agreement screening</p>
        <h1 id="page-title">Know what your agreement says—before it costs you.</h1>
        <p className="lede">
          Screen consumer-service terms in plain language, trace every signal to its exact source,
          and prepare an editable discussion draft.
        </p>
      </section>

      <section className="disclaimer" role="note">
        <strong>Important:</strong> This local MVP finds a limited set of wording patterns. It is
        not legal, medical, or financial advice and cannot determine enforceability or prove a
        document is safe.
      </section>

      <section className="ingest" aria-labelledby="ingest-title">
        <div>
          <p className="eyebrow">
            {publicAuthConfig.mode === 'local'
              ? 'Local development demo'
              : 'Authenticated workspace'}
          </p>
          <h2 id="ingest-title">Screen consumer agreement text</h2>
          <p>
            {publicAuthConfig.mode === 'local'
              ? 'Paste raw text only. The API is bound to this computer and uses a random browser session, but this is not production authentication or encrypted persistent storage.'
              : 'Paste raw text only. Your account session is held in memory and will require sign-in again when it expires.'}
          </p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="title">Document title</label>
          <input
            id="title"
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <div className="file-import">
            <label htmlFor="text-file">Import a .txt file</label>
            <input
              id="text-file"
              type="file"
              accept=".txt,text/plain"
              onChange={(event) => void importTextFile(event)}
            />
            <small>The file is read in your browser, then you choose when to screen it.</small>
          </div>
          <label htmlFor="document-text">Consumer agreement text</label>
          <textarea
            id="document-text"
            value={text}
            maxLength={250000}
            onChange={(event) => setText(event.target.value)}
            required
            rows={9}
          />
          <button type="submit" disabled={busy || !isAuthenticated}>
            {busy ? 'Screening…' : 'Run document X-Ray'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="workspace-history" aria-labelledby="history-title">
        <div className="history-heading">
          <div>
            <p className="eyebrow">
              {publicAuthConfig.mode === 'local'
                ? 'Local session workspace'
                : 'Your document workspace'}
            </p>
            <h2 id="history-title">Document history</h2>
          </div>
          <button
            type="button"
            className="secondary compact"
            onClick={() => void refreshDocuments()}
            disabled={!isAuthenticated || historyBusy}
          >
            {historyBusy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {documents.length ? (
          <div className="history-list">
            {documents.map((record) => {
              const signals = record.analysis?.clauses.filter(
                (clause) => clause.riskLevel !== 'SAFE',
              ).length;
              return (
                <button
                  type="button"
                  className="history-item"
                  aria-pressed={documentRecord?.id === record.id}
                  key={record.id}
                  onClick={() => openDocument(record)}
                >
                  <span>
                    <strong>{record.title}</strong>
                    <small>{new Date(record.updatedAt).toLocaleString()}</small>
                  </span>
                  <span className="history-status">{signals ?? 0} signals</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="history-empty">
            {historyBusy ? 'Loading local documents…' : 'No documents in this local session yet.'}
          </p>
        )}
      </section>

      {analysis && documentRecord && (
        <section className="results" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Screening complete</p>
              <h2 id="results-title">{analysis.documentMetadata.documentTitle}</h2>
              <p>{analysis.documentMetadata.executiveSummary}</p>
            </div>
            <div
              className="risk-score"
              aria-label={`${trapCount} high-risk and ${cautionCount} caution signals`}
            >
              <strong>{trapCount + cautionCount}</strong>
              <span>review signals</span>
            </div>
          </div>

          <div className="notice-list">
            {analysis.disclaimerFlags.map((flag) => (
              <span key={flag}>ⓘ {flag}</span>
            ))}
          </div>

          <div className="xray-grid">
            <article className="source-pane" aria-labelledby="source-title">
              <div className="pane-heading">
                <p className="eyebrow">Original document</p>
                <h3 id="source-title">Source text</h3>
              </div>
              <div className="source-content">
                <span>{source.before}</span>
                {source.selected && (
                  <mark ref={evidenceRef} className="source-highlight">
                    {source.selected}
                  </mark>
                )}
                <span>{source.after}</span>
              </div>
            </article>

            <article className="audit-pane" aria-labelledby="audit-title">
              <div className="pane-heading">
                <p className="eyebrow">What this may mean</p>
                <h3 id="audit-title">Review signals</h3>
              </div>
              <div className="clause-list">
                {!analysis.clauses.length && (
                  <div className="empty-state">
                    <strong>No supported signal found.</strong>
                    <p>
                      This limited screening cannot label the agreement safe. Review all terms
                      before acting.
                    </p>
                  </div>
                )}
                {analysis.clauses.map((clause) => (
                  <article
                    className={`clause-card ${clause.riskLevel.toLowerCase()}`}
                    key={clause.clauseId}
                  >
                    <button
                      className="clause-open"
                      onClick={() => chooseClause(clause)}
                      aria-expanded={selectedClauseId === clause.clauseId}
                    >
                      <span className="risk-chip">{riskLabel(clause.riskLevel)}</span>
                      <span>
                        <strong>{clause.category}</strong>
                        <small>Evidence confidence {Math.round(clause.confidence * 100)}%</small>
                      </span>
                      <span aria-hidden>↗</span>
                    </button>
                    {selectedClauseId === clause.clauseId && (
                      <div className="clause-detail">
                        <p>{clause.plainLanguageSummary}</p>
                        <p>
                          <strong>Why it matters:</strong> {clause.riskReasoning}
                        </p>
                        <p>
                          <strong>Balanced alternative:</strong> {clause.suggestedRevision}
                        </p>
                        <label className="select-clause">
                          <input
                            type="checkbox"
                            checked={selectedClauseIds.includes(clause.clauseId)}
                            onChange={() => toggleClause(clause.clauseId)}
                          />{' '}
                          Include this cited term in a draft
                        </label>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </article>
          </div>

          <div className="insights-grid">
            <article>
              <p className="eyebrow">Potential cost</p>
              <h3>{analysis.financialSummary.maximumLiabilityExposure}</h3>
              <p>{analysis.financialSummary.potentialHiddenFees}</p>
              <small>{analysis.financialSummary.calculationBreakdown[0]?.formula}</small>
            </article>
            <article>
              <p className="eyebrow">Exit requirements</p>
              {analysis.timelineChecklist.length ? (
                analysis.timelineChecklist.map((item) => (
                  <div key={item.step}>
                    <p>
                      <strong>{item.task}</strong>
                    </p>
                    <label htmlFor={`deadline-${item.step}`}>Confirm the relevant deadline</label>
                    <input
                      id={`deadline-${item.step}`}
                      type="date"
                      value={confirmedDate}
                      onChange={(event) => setConfirmedDate(event.target.value)}
                    />
                    <button onClick={exportCalendar} disabled={!confirmedDate}>
                      Download .ics calendar
                    </button>
                  </div>
                ))
              ) : (
                <p>No supported cancellation deadline signal was found.</p>
              )}
            </article>
            <article>
              <p className="eyebrow">Resolution drafts</p>
              <label htmlFor="recipient">Recipient</label>
              <input
                id="recipient"
                value={recipientRole}
                onChange={(event) => setRecipientRole(event.target.value)}
              />
              <div className="field-row">
                <label>
                  Draft type
                  <select
                    value={draftType}
                    onChange={(event) => setDraftType(event.target.value as DraftType)}
                  >
                    <option value="counter-proposal">Counter-proposal</option>
                    <option value="dispute">Dispute</option>
                  </select>
                </label>
                <label>
                  Tone
                  <select
                    value={draftTone}
                    onChange={(event) => setDraftTone(event.target.value as DraftTone)}
                  >
                    <option value="collaborative">Collaborative</option>
                    <option value="firm">Firm</option>
                  </select>
                </label>
              </div>
              <button onClick={generateDraft} disabled={busy || !selectedClauseIds.length}>
                {selectedClauseIds.length
                  ? `Create draft (${selectedClauseIds.length})`
                  : 'Select a cited term'}
              </button>
            </article>
          </div>

          {draft && (
            <section className="draft" aria-labelledby="draft-title">
              <div>
                <p className="eyebrow">Editable educational draft</p>
                <h3 id="draft-title">Verify every fact before using</h3>
              </div>
              <textarea
                aria-label="Editable resolution draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={13}
              />
              <button onClick={() => void navigator.clipboard.writeText(draft)}>Copy draft</button>
            </section>
          )}

          <section className="data-actions" aria-label="Local data controls">
            <button className="secondary" onClick={exportData}>
              Export audit data
            </button>
            <button className="danger" onClick={deleteDocument}>
              Delete local document
            </button>
          </section>
        </section>
      )}
    </main>
  );
}
