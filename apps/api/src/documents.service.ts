import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CalendarRequest,
  CreateDocumentInput,
  DocumentRecord,
  DraftRequest,
} from '@lexilens/contracts';
import { processingStatusSchema } from '@lexilens/contracts';
import { loadConfig } from './config';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';
import { auditConsumerDocument, detectDomain } from './services/audit-engine';
import { makeIcsCalendar } from './services/calendar';

@Injectable()
export class DocumentService {
  private readonly config = loadConfig();

  constructor(@Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort) {}

  async list(ownerId: string): Promise<DocumentRecord[]> {
    return this.persistence.listDocuments(ownerId);
  }

  async create(ownerId: string, input: CreateDocumentInput): Promise<DocumentRecord> {
    const domain = detectDomain(input.text);
    if (domain === 'HEALTHCARE' && !this.config.ENABLE_HEALTHCARE_ANALYSIS) {
      throw new BadRequestException(
        'Healthcare document analysis is disabled until required privacy and compliance controls are approved. No document was stored.',
      );
    }
    if (domain !== 'CONSUMER') {
      throw new BadRequestException(
        `${domain.toLowerCase()} analysis is not enabled in this consumer-document MVP. No document was stored.`,
      );
    }

    const now = new Date().toISOString();
    const contentHash = createHash('sha256').update(input.text).digest('hex');
    const quarantined: DocumentRecord = {
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
    const reservation = await this.persistence.reserveDocument(quarantined);
    const working = reservation.document;
    if (!reservation.created && !['QUARANTINED', 'PROCESSING', 'FAILED'].includes(working.status)) {
      return working;
    }

    await this.persistence.transitionDocument(
      ownerId,
      working.id,
      processingStatusSchema.enum.PROCESSING,
      null,
    );
    try {
      const analysis = auditConsumerDocument(working.title, working.sourceText);
      const completed = await this.persistence.transitionDocument(
        ownerId,
        working.id,
        processingStatusSchema.enum.COMPLETED,
        analysis,
      );
      if (!completed) throw new NotFoundException('Document not found.');
      return completed;
    } catch (error) {
      await this.persistence.transitionDocument(
        ownerId,
        working.id,
        processingStatusSchema.enum.FAILED,
        null,
      );
      throw error;
    }
  }

  async get(ownerId: string, id: string): Promise<DocumentRecord> {
    return this.requireOwned(ownerId, id);
  }

  async delete(ownerId: string, id: string): Promise<{ id: string; status: 'DELETED' }> {
    const deleted = await this.persistence.softDeleteDocument(ownerId, id);
    if (!deleted) throw new NotFoundException('Document not found.');
    return { id, status: 'DELETED' };
  }

  async createDraft(ownerId: string, id: string, request: DraftRequest) {
    const record = await this.requireOwned(ownerId, id);
    if (!record.analysis) throw new NotFoundException('This document has no available analysis.');
    const selected = record.analysis.clauses.filter((clause) =>
      request.clauseIds.includes(clause.clauseId),
    );
    if (!selected.length) throw new NotFoundException('No selected source clauses were found.');

    const changes = selected
      .map((clause) => `• ${clause.category}: ${clause.suggestedRevision}`)
      .join('\n');
    const firmRequest =
      request.tone === 'firm'
        ? 'I request a written response addressing each item.'
        : 'I would appreciate a written response addressing each item.';
    const purpose =
      request.draftType === 'dispute'
        ? `I am writing to dispute the application or interpretation of the selected terms in ${record.title}.`
        : `I am reviewing ${record.title} and would like to discuss these terms before proceeding.`;
    const action =
      request.draftType === 'dispute'
        ? 'Please review the cited language, explain the basis for the charge or decision, and correct any error supported by your records.'
        : 'Please confirm whether these balanced revisions can be considered.';

    return {
      recipientRole: request.recipientRole,
      subjectLine:
        request.draftType === 'dispute'
          ? `Dispute regarding ${record.title}`
          : `Request to revise ${record.title}`,
      sourceClauseIds: selected.map((clause) => clause.clauseId),
      formalLetterDraft: `Hello ${request.recipientRole},\n\n${purpose}\n\n${changes}\n\n${action} ${firmRequest}\n\nThank you,\n[Your name]`,
      tone: request.tone,
      draftType: request.draftType,
      disclaimer:
        'Review this educational draft for factual accuracy and seek qualified advice when appropriate.',
    };
  }

  async createCalendar(ownerId: string, id: string, request: CalendarRequest): Promise<string> {
    const record = await this.requireOwned(ownerId, id);
    if (!record.analysis) throw new NotFoundException('This document has no available analysis.');
    const confirmed = record.analysis.timelineChecklist.map((item) => {
      const userDate = request.confirmedDeadlines.find((entry) => entry.step === item.step);
      return userDate ? { ...item, deadline: userDate.deadline, needsUserContext: false } : item;
    });
    return makeIcsCalendar(record.title, confirmed);
  }

  private async requireOwned(ownerId: string, id: string): Promise<DocumentRecord> {
    const record = await this.persistence.findDocument(ownerId, id);
    if (!record) throw new NotFoundException('Document not found.');
    return record;
  }
}
