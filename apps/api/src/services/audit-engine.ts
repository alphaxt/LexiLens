import {
  ANALYSIS_VERSION,
  auditSchema,
  type Audit,
  type Clause,
  type Domain,
} from '@lexilens/contracts';

const DISCLAIMER_FLAGS = [
  'Educational information only; this is not legal, medical, or financial advice.',
  'This analysis does not determine whether a term is enforceable in your jurisdiction.',
  'Verify important deadlines, fees, and rights against the original document.',
];

type Rule = {
  category: string;
  pattern: RegExp;
  riskLevel: Clause['riskLevel'];
  summary: string;
  reasoning: string;
  revision: string;
};

const CONSUMER_RULES: Rule[] = [
  {
    category: 'Automatic renewal',
    pattern: /(?:automatically? renew|auto(?:matic(?:ally)?)? renewal|renew(?:s|al) for)/i,
    riskLevel: 'TRAP',
    summary: 'This may renew your agreement unless you cancel before a stated deadline.',
    reasoning: 'Automatic renewal can create unexpected charges or extend the commitment.',
    revision:
      'Require written renewal consent after the current term ends and clear advance notice.',
  },
  {
    category: 'Arbitration or class-action waiver',
    pattern: /(?:binding arbitration|arbitrat(?:e|ion)|class action waiver|waive .*class)/i,
    riskLevel: 'TRAP',
    summary: 'This may limit your ability to take a dispute to court or join a group claim.',
    reasoning: 'It can narrow dispute-resolution options and make small claims harder to pursue.',
    revision:
      'Make arbitration optional and preserve access to court and class proceedings where allowed.',
  },
  {
    category: 'Cancellation and notice',
    pattern: /(?:cancel(?:lation)?|terminate|notice).{0,80}(?:days?|written|certified|mail)/i,
    riskLevel: 'CAUTION',
    summary:
      'Cancellation appears to require a specific process, notice period, or delivery method.',
    reasoning: 'Missing a procedural step can lead to an unwanted renewal or additional fee.',
    revision:
      'Allow cancellation through a simple written or online notice with confirmation of receipt.',
  },
  {
    category: 'Unilateral changes',
    pattern: /(?:sole discretion|may modify|right to change|change .* at any time)/i,
    riskLevel: 'CAUTION',
    summary: 'The other party may be able to change terms without your affirmative agreement.',
    reasoning: 'One-sided changes can alter price, service, or obligations after you agree.',
    revision: 'Require advance notice and an option to reject material changes without penalty.',
  },
  {
    category: 'Fees and penalties',
    pattern: /(?:late fee|penalt(?:y|ies)|collection fee|interest .*%|nonrefundable)/i,
    riskLevel: 'CAUTION',
    summary: 'This clause may add fees, penalties, or interest beyond the advertised price.',
    reasoning: 'The total cost may increase if payment or cancellation conditions are missed.',
    revision: 'Cap fees, disclose the calculation clearly, and provide a reasonable cure period.',
  },
  {
    category: 'Liability limitation',
    pattern: /(?:limit(?:ation)? of liability|not liable|hold harmless|indemnif)/i,
    riskLevel: 'CAUTION',
    summary: 'This may limit the other party’s responsibility or shift losses to you.',
    reasoning: 'A broad limitation may reduce available remedies if service causes harm or loss.',
    revision:
      'Make liability limits mutual and preserve remedies for intentional misconduct or gross negligence.',
  },
  {
    category: 'Privacy and data use',
    pattern: /(?:personal data|share .* data|sell .* data|privacy policy|tracking)/i,
    riskLevel: 'CAUTION',
    summary: 'This clause describes how your information may be collected, used, or shared.',
    reasoning: 'Broad data permissions may allow uses you do not expect.',
    revision:
      'Limit collection to necessary purposes and require opt-in consent for sharing or sale.',
  },
];

export function detectDomain(text: string): Domain | 'UNKNOWN' {
  if (/(?:lease|landlord|tenant|security deposit|rent)/i.test(text)) return 'HOUSING';
  if (/(?:employer|employment|contractor|non-compete|intellectual property)/i.test(text))
    return 'EMPLOYMENT';
  if (
    /(?:patient|hospital|insurance|medical|consent|clinic|clinical|physician|doctor|treatment|diagnosis|therapy|chemotherapy|prescription|health care|healthcare)/i.test(
      text,
    )
  )
    return 'HEALTHCARE';
  if (/(?:apr|loan|credit|interest rate|lender)/i.test(text)) return 'FINANCE';
  if (
    /(?:membership|subscription|service terms|terms of service|account|renewal|cancel(?:lation)?|late fee|arbitration|privacy policy|platform|gym contract)/i.test(
      text,
    )
  )
    return 'CONSUMER';
  return 'UNKNOWN';
}

function segments(text: string): Array<{ text: string; start: number }> {
  const matches = [...text.matchAll(/[^\n]+(?:\n|$)/g)];
  const lines = matches
    .map((match) => {
      const raw = match[0].replace(/\r?\n$/, '');
      const leadingWhitespace = raw.length - raw.trimStart().length;
      return { text: raw.trim(), start: (match.index ?? 0) + leadingWhitespace };
    })
    .filter((line) => line.text.length > 12);
  const fallback = text.trim();
  const fallbackStart = text.length - text.trimStart().length;
  return lines.length ? lines : [{ text: fallback, start: fallbackStart }];
}

function toClause(
  rule: Rule,
  text: string,
  start: number,
  index: number,
  matchStart: number,
  matchLength: number,
): Clause {
  const evidenceLimit = 2000;
  const availableContext = Math.max(0, evidenceLimit - matchLength);
  const preferredStart = matchStart - Math.floor(availableContext / 2);
  const excerptStart = Math.max(0, Math.min(preferredStart, text.length - evidenceLimit));
  const excerptEnd = Math.min(text.length, excerptStart + evidenceLimit);
  const excerpt = text.slice(excerptStart, excerptEnd);
  return {
    clauseId: `clause-${index + 1}`,
    originalText: excerpt,
    plainLanguageSummary: rule.summary,
    riskLevel: rule.riskLevel,
    riskReasoning: rule.reasoning,
    category: rule.category,
    suggestedRevision: rule.revision,
    evidence: {
      pageNumber: null,
      startOffset: start + excerptStart,
      endOffset: start + excerptEnd,
      excerpt,
      confidence: 0.88,
    },
    confidence: 0.88,
    reviewState: 'READY',
  };
}

function extractAmount(text: string): number | null {
  const matched = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
  if (!matched?.[1]) return null;
  const parsed = Number(matched[1].replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(amount: number | null): string {
  return amount === null
    ? 'Not determinable from the available text'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function auditConsumerDocument(title: string, sourceText: string): Audit {
  const clauses: Clause[] = [];
  for (const segment of segments(sourceText)) {
    for (const rule of CONSUMER_RULES) {
      const match = segment.text.match(rule.pattern);
      if (match) {
        clauses.push(
          toClause(
            rule,
            segment.text,
            segment.start,
            clauses.length,
            match.index ?? 0,
            match[0].length,
          ),
        );
      }
    }
  }
  const baseAmount = extractAmount(sourceText);
  const feeClauses = clauses.filter((clause) => clause.category === 'Fees and penalties');
  const traps = clauses.filter((clause) => clause.riskLevel === 'TRAP').length;
  const cautions = clauses.filter((clause) => clause.riskLevel === 'CAUTION').length;
  const notice = sourceText.match(
    /(?:(\d{1,3})\s+(?:calendar\s+)?days?[^.\n]{0,70}(?:before|notice|cancel|termination)|(?:notice|cancel(?:lation)?|terminate)[^.\n]{0,70}?(\d{1,3})\s+(?:calendar\s+)?days?)/i,
  );
  const noticeDays = notice?.[1] ?? notice?.[2];
  const timelineChecklist = noticeDays
    ? [
        {
          step: 1,
          task: `Provide cancellation notice at least ${noticeDays} days before the relevant renewal or end date.`,
          deadline: null,
          deadlineType: 'RELATIVE_TO_EVENT' as const,
          mandatory: true,
          sourceClauseIds: clauses
            .filter((clause) => clause.category === 'Cancellation and notice')
            .map((c) => c.clauseId),
          needsUserContext: true,
        },
      ]
    : [];

  const audit: Audit = {
    analysisVersion: ANALYSIS_VERSION,
    rulePackVersion: 'consumer-us-general-1.0.0',
    modelProvider: 'deterministic-demo',
    documentMetadata: {
      detectedDomain: 'CONSUMER',
      documentTitle: title,
      overallRiskScore: clauses.length ? Math.min(100, traps * 30 + cautions * 12) : null,
      executiveSummary:
        traps || cautions
          ? `Found ${traps} high-risk and ${cautions} caution item${traps + cautions === 1 ? '' : 's'} to review.`
          : 'No high-signal consumer risk patterns were found. Review the full document before acting.',
    },
    disclaimerFlags: DISCLAIMER_FLAGS,
    financialSummary: {
      baseAmount: formatUsd(baseAmount),
      potentialHiddenFees: feeClauses.length
        ? 'Possible fees or penalties detected; review the cited clauses.'
        : 'No fee pattern detected.',
      maximumLiabilityExposure:
        'Not determinable—this screening does not prove a maximum exposure.',
      calculationBreakdown: [
        {
          label: 'Amount stated in document',
          amount: baseAmount,
          currency: 'USD',
          formula: 'First dollar-denominated amount found in the provided text.',
          assumptions: ['Only explicit dollar amounts can be calculated in this local analysis.'],
          uncertainty: baseAmount === null ? 'No dollar amount was found.' : null,
          evidenceClauseIds: feeClauses.map((clause) => clause.clauseId),
        },
      ],
    },
    clauses,
    timelineChecklist,
    negotiationResolution: {
      recipientRole: 'Account representative',
      subjectLine: `Request to clarify terms in ${title}`,
      formalLetterDraft:
        'Select one or more cited clauses to create an editable, evidence-linked draft.',
      sourceClauseIds: clauses
        .filter((clause) => clause.riskLevel !== 'SAFE')
        .map((clause) => clause.clauseId),
    },
  };
  return auditSchema.parse(audit);
}
