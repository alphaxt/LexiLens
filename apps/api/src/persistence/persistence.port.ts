import type {
  Account,
  Audit,
  DocumentRecord,
  ExtractionArtifact,
  ExtractionFailure,
  ProcessingStatus,
  SecurityEvent,
  UpdatePrivacyPreferences,
} from '@lexilens/contracts';
import type { PersistenceMode } from '@lexilens/database';

export const PERSISTENCE_PORT = Symbol('PERSISTENCE_PORT');
export interface PersistencePrincipal {
  ownerId: string;
  subject: string;
  mode: 'local' | 'oidc';
}
export interface DocumentReservation {
  document: DocumentRecord;
  created: boolean;
}
export interface ExtractionClaim {
  document: DocumentRecord;
  leaseId: string;
}
export interface LeaseReconciliationResult {
  requeued: number;
  exhausted: number;
}
export type CleanupReason =
  | 'USER_DELETE'
  | 'ACCOUNT_DELETE'
  | 'RETENTION_EXPIRED'
  | 'REJECTED_UPLOAD';
export interface CleanupTask {
  id: string;
  ownerId: string;
  documentId: string | null;
  objectKey: string;
  reason: CleanupReason;
  attempts: number;
  leaseId: string;
}
export interface CleanupReconciliationResult {
  claimed: number;
  deleted: number;
  failed: number;
  expired: number;
  accountsFinalized: number;
}
export interface AccountExport {
  exportedAt: string;
  account: Account;
  documents: DocumentRecord[];
  securityEvents: SecurityEvent[];
}
export interface PersistenceHealth {
  healthy: boolean;
  mode: PersistenceMode;
  schemaVersion: string;
}
export interface PersistencePort {
  listDocuments(ownerId: string): Promise<DocumentRecord[]>;
  findDocument(ownerId: string, id: string): Promise<DocumentRecord | undefined>;
  reserveDocument(record: DocumentRecord): Promise<DocumentReservation>;
  transitionDocument(
    ownerId: string,
    id: string,
    status: ProcessingStatus,
    analysis: Audit | null,
  ): Promise<DocumentRecord | undefined>;
  updateUploadMetadata(
    ownerId: string,
    id: string,
    metadata: Pick<DocumentRecord, 'detectedMime' | 'scanResult' | 'rejectionCode'>,
  ): Promise<DocumentRecord | undefined>;
  claimReadyForExtraction(
    ownerId: string,
    id: string,
    leaseMs: number,
  ): Promise<ExtractionClaim | undefined>;
  completeExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: ExtractionArtifact,
    analysis: Audit,
  ): Promise<DocumentRecord | undefined>;
  failExtraction(
    ownerId: string,
    id: string,
    leaseId: string,
    artifact: ExtractionArtifact | null,
    failure: ExtractionFailure,
  ): Promise<DocumentRecord | undefined>;
  reconcileExpiredExtractionLeases(
    maxAttempts: number,
    batchSize: number,
    now?: Date,
  ): Promise<LeaseReconciliationResult>;
  requestDocumentDeletion(
    ownerId: string,
    id: string,
    reason?: CleanupReason,
  ): Promise<{ status: 'PENDING' | 'DELETED' } | undefined>;
  requestAccountDeletion(
    principal: PersistencePrincipal,
  ): Promise<{ status: 'PENDING'; purgedDocuments: number }>;
  claimCleanupTasks(batchSize: number, leaseMs: number, now?: Date): Promise<CleanupTask[]>;
  completeCleanupTask(task: CleanupTask): Promise<void>;
  failCleanupTask(task: CleanupTask, errorCode: string, retryAfterMs: number): Promise<void>;
  enqueueExpiredRetention(batchSize: number, now?: Date): Promise<number>;
  finalizeDeletedAccounts(): Promise<number>;
  getOrCreateAccount(principal: PersistencePrincipal): Promise<Account>;
  updatePrivacy(principal: PersistencePrincipal, input: UpdatePrivacyPreferences): Promise<Account>;
  exportAccount(principal: PersistencePrincipal): Promise<AccountExport>;
  listSecurityEvents(ownerId: string): Promise<SecurityEvent[]>;
  health(): Promise<PersistenceHealth>;
}
