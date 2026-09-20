import { z } from 'zod';

export const ANALYSIS_VERSION = '2026-03-lexilens-v1';
export const RISK_LEVELS = ['SAFE', 'CAUTION', 'TRAP'] as const;
export const DOMAINS = ['HOUSING', 'EMPLOYMENT', 'HEALTHCARE', 'FINANCE', 'CONSUMER'] as const;

export const riskLevelSchema = z.enum(RISK_LEVELS);
export const domainSchema = z.enum(DOMAINS);
export const processingStatusSchema = z.enum([
  'UPLOADING',
  'QUARANTINED',
  'REJECTED',
  'READY_FOR_EXTRACTION',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DELETED',
]);

export const sourceEvidenceSchema = z
  .object({
    pageNumber: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    excerpt: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .refine((evidence) => evidence.endOffset > evidence.startOffset, {
    message: 'Evidence end offset must be greater than its start offset.',
    path: ['endOffset'],
  });

export const clauseSchema = z.object({
  clauseId: z.string().min(1),
  originalText: z.string().min(1),
  plainLanguageSummary: z.string().min(1),
  riskLevel: riskLevelSchema,
  riskReasoning: z.string().min(1),
  category: z.string().min(1),
  suggestedRevision: z.string().min(1),
  evidence: sourceEvidenceSchema,
  confidence: z.number().min(0).max(1),
  reviewState: z.enum(['READY', 'REVIEW_NEEDED']),
});

export const calculationSchema = z.object({
  label: z.string().min(1),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().length(3),
  formula: z.string().min(1),
  assumptions: z.array(z.string()),
  uncertainty: z.string().nullable(),
  evidenceClauseIds: z.array(z.string()),
});

export const timelineItemSchema = z.object({
  step: z.number().int().positive(),
  task: z.string().min(1),
  deadline: z.string().datetime().nullable(),
  deadlineType: z.enum(['EXACT_DATE', 'RELATIVE_TO_EVENT', 'RECURRING', 'AMBIGUOUS']),
  mandatory: z.boolean(),
  sourceClauseIds: z.array(z.string()),
  needsUserContext: z.boolean(),
});

export const auditSchema = z.object({
  analysisVersion: z.string(),
  rulePackVersion: z.string(),
  modelProvider: z.literal('deterministic-demo'),
  documentMetadata: z.object({
    detectedDomain: domainSchema,
    documentTitle: z.string().min(1),
    overallRiskScore: z.number().int().min(0).max(100).nullable(),
    executiveSummary: z.string().min(1),
  }),
  disclaimerFlags: z.array(z.string()),
  financialSummary: z.object({
    baseAmount: z.string(),
    potentialHiddenFees: z.string(),
    maximumLiabilityExposure: z.string(),
    calculationBreakdown: z.array(calculationSchema),
  }),
  clauses: z.array(clauseSchema),
  timelineChecklist: z.array(timelineItemSchema),
  negotiationResolution: z.object({
    recipientRole: z.string(),
    subjectLine: z.string(),
    formalLetterDraft: z.string(),
    sourceClauseIds: z.array(z.string()),
  }),
});

export const uploadMimeSchema = z.enum([
  'text/plain',
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
export const uploadRejectionCodeSchema = z.enum([
  'EMPTY_CONTENT',
  'OVERSIZED_CONTENT',
  'UNSUPPORTED_DECLARED_MIME',
  'INVALID_MAGIC_BYTES',
  'MIME_MISMATCH',
  'SCANNER_ERROR',
]);

export const documentSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  title: z.string().min(1).max(180),
  sourceText: z.string(),
  contentHash: z.string().length(64),
  status: processingStatusSchema,
  originalFilename: z.string().max(180).nullable().default(null),
  declaredMime: uploadMimeSchema.nullable().default(null),
  detectedMime: uploadMimeSchema.nullable().default(null),
  byteSize: z.number().int().nonnegative().nullable().default(null),
  scanResult: z.enum(['PENDING', 'CLEAN', 'REJECTED', 'ERROR']).nullable().default(null),
  rejectionCode: uploadRejectionCodeSchema.nullable().default(null),
  storageKey: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  analysis: auditSchema.nullable(),
});

/** Client-safe metadata: private storage identifiers and content are intentionally omitted. */
export const documentMetadataSchema = documentSchema.omit({
  ownerId: true,
  sourceText: true,
  contentHash: true,
  storageKey: true,
});

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(180),
  text: z.string().trim().min(1).max(1_000_000),
  filename: z.string().trim().min(1).max(180).optional(),
  mimeType: z.literal('text/plain').default('text/plain'),
});

export const draftRequestSchema = z.object({
  clauseIds: z.array(z.string()).min(1).max(5),
  recipientRole: z.string().trim().min(2).max(100),
  tone: z.enum(['firm', 'collaborative']).default('collaborative'),
  draftType: z.enum(['counter-proposal', 'dispute']).default('counter-proposal'),
});

export const calendarRequestSchema = z.object({
  confirmedDeadlines: z
    .array(
      z.object({
        step: z.number().int().positive(),
        deadline: z.string().datetime(),
      }),
    )
    .min(1),
});

export type Audit = z.infer<typeof auditSchema>;
export type Clause = z.infer<typeof clauseSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;
export type Domain = z.infer<typeof domainSchema>;
export type ProcessingStatus = z.infer<typeof processingStatusSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type DraftRequest = z.infer<typeof draftRequestSchema>;
export type CalendarRequest = z.infer<typeof calendarRequestSchema>;

export const retentionPolicySchema = z.enum(['SESSION', '7_DAYS', '30_DAYS', '90_DAYS']);

export const privacyPreferencesSchema = z.object({
  retentionPolicy: retentionPolicySchema,
  consentAccepted: z.boolean(),
  consentVersion: z.string().min(1).nullable(),
  consentedAt: z.string().datetime().nullable(),
});

export const updatePrivacyPreferencesSchema = z
  .object({
    retentionPolicy: retentionPolicySchema.optional(),
    acceptConsentVersion: z.string().trim().min(1).max(50).optional(),
  })
  .refine(
    (input) => input.retentionPolicy !== undefined || input.acceptConsentVersion !== undefined,
    {
      message: 'At least one privacy preference must be supplied.',
    },
  );

export const accountSchema = z.object({
  ownerId: z.string().min(1),
  subject: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  privacy: privacyPreferencesSchema,
});

export const securityEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['ACCOUNT_INITIALIZED', 'PRIVACY_UPDATED', 'DATA_EXPORTED', 'ACCOUNT_DELETED']),
  occurredAt: z.string().datetime(),
  actorMode: z.enum(['local', 'oidc']),
});

export type Account = z.infer<typeof accountSchema>;
export type PrivacyPreferences = z.infer<typeof privacyPreferencesSchema>;
export type UpdatePrivacyPreferences = z.infer<typeof updatePrivacyPreferencesSchema>;
export type SecurityEvent = z.infer<typeof securityEventSchema>;
