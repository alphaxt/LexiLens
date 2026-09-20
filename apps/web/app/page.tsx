'use client';

import type { Clause, DocumentRecord } from '@lexilens/contracts';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { riskLabel, sliceSource } from '../lib/presentation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
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
  const [sessionId, setSessionId] = useState('');
  const [title, setTitle] = useState('Membership agreement');
  const [text, setText] = useState(SAMPLE);
  const [documentRecord, setDocumentRecord] = useState<DocumentRecord | null>(null);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<DraftType>('counter-proposal');
  const [draftTone, setDraftTone] = useState<DraftTone>('collaborative');
  const [recipientRole, setRecipientRole] = useState('Account representative');
  const [confirmedDate, setConfirmedDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const evidenceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem('lexilens-local-session');
    const id = stored ?? window.crypto.randomUUID();
    window.localStorage.setItem('lexilens-local-session', id);
    setSessionId(id);
  }, []);

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
    return {
      ...(withJson ? { 'content-type': 'application/json' } : {}),
      'x-local-session-id': sessionId,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const response = await fetch(`${API_URL}/documents`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ title, text, mimeType: 'text/plain' }),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(problem?.message ?? 'The document could not be screened.');
      }
      const result = (await response.json()) as DocumentRecord;
      setDocumentRecord(result);
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
    setDocumentRecord(null);
    setDraft(null);
    setSelectedClauseIds([]);
  }

  return (
    <main>
      <header className="site-header">
        <div className="brand" aria-label="LexiLens home">
          <span aria-hidden>◈</span> LexiLens
        </div>
        <p>Evidence-first document X-Ray</p>
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
          <p className="eyebrow">Local development demo</p>
          <h2 id="ingest-title">Screen consumer agreement text</h2>
          <p>
            Paste raw text only. The API is bound to this computer and uses a random browser
            session, but this is not production authentication or encrypted persistent storage.
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
          <label htmlFor="document-text">Consumer agreement text</label>
          <textarea
            id="document-text"
            value={text}
            maxLength={250000}
            onChange={(event) => setText(event.target.value)}
            required
            rows={9}
          />
          <button type="submit" disabled={busy || !sessionId}>
            {busy ? 'Screening…' : 'Run document X-Ray'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
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
