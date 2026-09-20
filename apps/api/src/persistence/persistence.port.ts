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
  listStorageKeys(ownerId: string): Promise<string[]>;
  softDeleteDocument(ownerId: string, id: string): Promise<boolean>;
  getOrCreateAccount(principal: PersistencePrincipal): Promise<Account>;
  updatePrivacy(principal: PersistencePrincipal, input: UpdatePrivacyPreferences): Promise<Account>;
  exportAccount(principal: PersistencePrincipal): Promise<AccountExport>;
  deleteOwner(
    principal: PersistencePrincipal,
  ): Promise<{ status: 'DELETED'; purgedDocuments: number }>;
  listSecurityEvents(ownerId: string): Promise<SecurityEvent[]>;
  health(): Promise<PersistenceHealth>;
}
