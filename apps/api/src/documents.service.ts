import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CalendarRequest,
  CreateDocumentInput,
  DocumentRecord,
  DraftRequest,
} from '@lexilens/contracts';
import { processingStatusSchema } from '@lexilens/contracts';
import { loadConfig } from './config';
import { auditConsumerDocument, detectDomain } from './services/audit-engine';
import { makeIcsCalendar } from './services/calendar';

@Injectable()
export class DocumentService {
  private readonly records = new Map<string, DocumentRecord>();
  private readonly config = loadConfig();

  list(ownerId: string): DocumentRecord[] {
    return [...this.records.values()]
      .filter((record) => record.ownerId === ownerId && record.status !== 'DELETED')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(ownerId: string, input: CreateDocumentInput): DocumentRecord {
    const domain = detectDomain(input.text);
    if (domain === 'HEALTHCARE' && !this.config.ENABLE_HEALTHCARE_ANALYSIS) {
      throw new BadRequestException('Healthcare document analysis is disabled until required privacy and compliance controls are approved. No document was stored.');
    }
    if (domain !== 'CONSUMER') {
      throw new BadRequestException(`${domain.toLowerCase()} analysis is not enabled in this consumer-document MVP. No document was stored.`);
    }

    const now = new Date().toISOString();
    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const duplicate = this.list(ownerId).find((record) => record.contentHash === contentHash);
    if (duplicate) return duplicate;

    // This local adapter accepts extracted raw text only. Production replaces this boundary with
    // OIDC identity, signed private uploads, quarantine scanning, extraction/OCR, and worker queues.
    let record: DocumentRecord = {
      id: randomUUID(),
      ownerId,
      title: input.title,
      sourceText: input.text,
      contentHash,
      status: processingStatusSchema.enum.QUARANTINED,
      createdAt: now,
      updatedAt: now,
      analysis: null,
    };
    this.records.set(record.id, record);
    record = { ...record, status: processingStatusSchema.enum.PROCESSING, updatedAt: new Date().toISOString() };
    record = {
      ...record,
      status: processingStatusSchema.enum.COMPLETED,
      updatedAt: new Date().toISOString(),
      analysis: auditConsumerDocument(record.title, record.sourceText),
    };
    this.records.set(record.id, record);
    return record;
  }

  get(ownerId: string, id: string): DocumentRecord {
    return this.requireOwned(ownerId, id);
  }

  delete(ownerId: string, id: string): { id: string; status: 'DELETED' } {
    const record = this.requireOwned(ownerId, id);
    this.records.set(id, {
      ...record,
      sourceText: '',
      analysis: null,
      status: processingStatusSchema.enum.DELETED,
      updatedAt: new Date().toISOString(),
    });
    return { id, status: 'DELETED' };
  }

  createDraft(ownerId: string, id: string, request: DraftRequest) {
    const record = this.requireOwned(ownerId, id);
    if (!record.analysis) throw new NotFoundException('This document has no available analysis.');
    const selected = record.analysis.clauses.filter((clause) => request.clauseIds.includes(clause.clauseId));
    if (!selected.length) throw new NotFoundException('No selected source clauses were found.');

    const changes = selected.map((clause) => `• ${clause.category}: ${clause.suggestedRevision}`).join('\n');
    const firmRequest = request.tone === 'firm' ? 'I request a written response addressing each item.' : 'I would appreciate a written response addressing each item.';
    const purpose = request.draftType === 'dispute'
      ? `I am writing to dispute the application or interpretation of the selected terms in ${record.title}.`
      : `I am reviewing ${record.title} and would like to discuss these terms before proceeding.`;
    const action = request.draftType === 'dispute'
      ? 'Please review the cited language, explain the basis for the charge or decision, and correct any error supported by your records.'
      : 'Please confirm whether these balanced revisions can be considered.';

    return {
      recipientRole: request.recipientRole,
      subjectLine: request.draftType === 'dispute' ? `Dispute regarding ${record.title}` : `Request to revise ${record.title}`,
      sourceClauseIds: selected.map((clause) => clause.clauseId),
      formalLetterDraft: `Hello ${request.recipientRole},\n\n${purpose}\n\n${changes}\n\n${action} ${firmRequest}\n\nThank you,\n[Your name]`,
      tone: request.tone,
      draftType: request.draftType,
      disclaimer: 'Review this educational draft for factual accuracy and seek qualified advice when appropriate.',
    };
  }

  createCalendar(ownerId: string, id: string, request: CalendarRequest): string {
    const record = this.requireOwned(ownerId, id);
    if (!record.analysis) throw new NotFoundException('This document has no available analysis.');
    const confirmed = record.analysis.timelineChecklist.map((item) => {
      const userDate = request.confirmedDeadlines.find((entry) => entry.step === item.step);
      return userDate ? { ...item, deadline: userDate.deadline, needsUserContext: false } : item;
    });
    return makeIcsCalendar(record.title, confirmed);
  }

  private requireOwned(ownerId: string, id: string): DocumentRecord {
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId || record.status === 'DELETED') {
      throw new NotFoundException('Document not found.');
    }
    return record;
  }
}
