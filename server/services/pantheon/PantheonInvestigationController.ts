import { getPantheonPrimaryCrawlerCapabilitiesForCategory } from './PantheonCrawlerCapabilityMatrix';

export const PANTHEON_CORE_CRAWLER_CAPABILITIES = [
  'startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich',
] as const;

export type PantheonCoreCrawlerCapability = typeof PANTHEON_CORE_CRAWLER_CAPABILITIES[number];
export type PantheonCategoryCompletionState = 'completed' | 'partial' | 'blocked' | 'not_started';

interface CrawlerAuditLike {
  crawler?: string;
  status?: string;
  attempts?: number;
  targets?: number;
  error?: string;
}

interface LedgerEntryLike {
  state?: string;
  attempts?: number;
  startedAt?: string;
  completedAt?: string;
  result?: { status?: number };
}

export interface PantheonCategoryAssessmentInput {
  label: string;
  targetCount: number;
  expectedCapabilities?: readonly string[];
  crawlerAudit: readonly CrawlerAuditLike[];
  urlLedger: readonly LedgerEntryLike[];
}

export interface PantheonCategoryAssessment {
  state: PantheonCategoryCompletionState;
  reason: string;
  expectedCapabilities: PantheonCoreCrawlerCapability[];
  executedCapabilities: PantheonCoreCrawlerCapability[];
  missingCapabilities: PantheonCoreCrawlerCapability[];
  attemptedUrlCount: number;
}

const SIMULATION_MARKERS = /(?:simulat(?:e|ed|ion)|mirrored|synthetic|test[ _-]?mode|seven-crawler-initiative|cooperativeanalysis|entropysignature)/i;
const TERMINAL_LEDGER_STATES = new Set(['accepted', 'rejected', 'blocked', 'rate_limited', 'dead', 'timed_out', 'no_evidence']);

export function plannedPantheonCrawlerCapabilitiesForCategory(label: string): PantheonCoreCrawlerCapability[] {
  return [...getPantheonPrimaryCrawlerCapabilitiesForCategory(label)];
}

export function isPantheonSimulatedOutput(value: unknown): boolean {
  return SIMULATION_MARKERS.test(String(value || ''));
}

export function isLivePantheonCrawlerAudit(audit: CrawlerAuditLike): audit is CrawlerAuditLike & { crawler: PantheonCoreCrawlerCapability } {
  const crawler = String(audit.crawler || '').toLowerCase();
  return PANTHEON_CORE_CRAWLER_CAPABILITIES.includes(crawler as PantheonCoreCrawlerCapability)
    && Number(audit.attempts || 0) > 0
    && Number(audit.targets || 0) > 0
    && !isPantheonSimulatedOutput([audit.crawler, audit.status, audit.error].join(' '));
}

export function assessPantheonCategoryOutcome(input: PantheonCategoryAssessmentInput): PantheonCategoryAssessment {
  const expectedCapabilities = [...new Set(
    (input.expectedCapabilities?.length
      ? input.expectedCapabilities
      : plannedPantheonCrawlerCapabilitiesForCategory(input.label)
    ).filter((capability): capability is PantheonCoreCrawlerCapability =>
      PANTHEON_CORE_CRAWLER_CAPABILITIES.includes(capability as PantheonCoreCrawlerCapability)
    )
  )];

  const liveAudits = input.crawlerAudit.filter(isLivePantheonCrawlerAudit);
  const executedCapabilities = [...new Set(liveAudits.map(audit => audit.crawler))];
  const missingCapabilities = expectedCapabilities.filter(capability => !executedCapabilities.includes(capability));
  const attemptedEntries = input.urlLedger.filter(entry =>
    Number(entry.attempts || 0) > 0 && Boolean(entry.startedAt) && Boolean(entry.completedAt)
  );
  const activeEntries = input.urlLedger.filter(entry =>
    Number(entry.attempts || 0) > 0 && !TERMINAL_LEDGER_STATES.has(String(entry.state || ''))
  );
  const failedCapabilities = liveAudits
    .filter(audit => /^(failed|timed_out)$/i.test(String(audit.status || '')))
    .map(audit => audit.crawler);

  if (input.targetCount <= 0 || attemptedEntries.length === 0) {
    return {
      state: 'not_started',
      reason: 'No live source URL was completed for this category.',
      expectedCapabilities,
      executedCapabilities,
      missingCapabilities,
      attemptedUrlCount: attemptedEntries.length,
    };
  }

  if (activeEntries.length > 0 || missingCapabilities.length > 0 || failedCapabilities.length > 0) {
    const reason = activeEntries.length > 0
      ? 'Assigned source work did not reach a terminal outcome.'
      : missingCapabilities.length > 0
        ? `Required crawler capabilities did not execute: ${missingCapabilities.join(', ')}.`
        : `Crawler capabilities did not finish cleanly: ${[...new Set(failedCapabilities)].join(', ')}.`;
    return {
      state: missingCapabilities.length && liveAudits.length === 0 ? 'blocked' : 'partial',
      reason,
      expectedCapabilities,
      executedCapabilities,
      missingCapabilities,
      attemptedUrlCount: attemptedEntries.length,
    };
  }

  return {
    state: 'completed',
    reason: 'Live source work and every required crawler capability completed.',
    expectedCapabilities,
    executedCapabilities,
    missingCapabilities,
    attemptedUrlCount: attemptedEntries.length,
  };
}

export interface PantheonInvestigationAssessment {
  state: 'completed' | 'partial';
  completedCategoryCount: number;
  partialCategoryCount: number;
  missingCapabilities: PantheonCoreCrawlerCapability[];
  releaseEligible: boolean;
}

export function assessPantheonInvestigation(categories: readonly {
  completionState?: PantheonCategoryCompletionState;
  expectedCapabilities?: readonly string[];
  crawlerAudit?: readonly CrawlerAuditLike[];
}[]): PantheonInvestigationAssessment {
  const required = new Set<PantheonCoreCrawlerCapability>();
  const executed = new Set<PantheonCoreCrawlerCapability>();
  let completedCategoryCount = 0;

  for (const category of categories) {
    if (category.completionState === 'completed') completedCategoryCount += 1;
    for (const capability of category.expectedCapabilities || []) {
      if (PANTHEON_CORE_CRAWLER_CAPABILITIES.includes(capability as PantheonCoreCrawlerCapability)) {
        required.add(capability as PantheonCoreCrawlerCapability);
      }
    }
    for (const audit of category.crawlerAudit || []) {
      if (isLivePantheonCrawlerAudit(audit) && !/^(failed|timed_out)$/i.test(String(audit.status || ''))) {
        executed.add(audit.crawler);
      }
    }
  }

  const missingCapabilities = [...required].filter(capability => !executed.has(capability));
  const partialCategoryCount = Math.max(0, categories.length - completedCategoryCount);
  return {
    state: partialCategoryCount === 0 && missingCapabilities.length === 0 ? 'completed' : 'partial',
    completedCategoryCount,
    partialCategoryCount,
    missingCapabilities,
    releaseEligible: partialCategoryCount === 0 && missingCapabilities.length === 0,
  };
}
