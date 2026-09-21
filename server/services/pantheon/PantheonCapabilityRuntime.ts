import {
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_PRIMARY_CRAWLER_IDS,
  PANTHEON_REPORT_CATEGORY_LABELS,
  getPantheonCategoryCapabilities,
  getPantheonPrimaryCrawlerCapabilitiesForCategory,
  type PantheonCapabilityId,
  type PantheonPrimaryCrawlerId,
  type PantheonReportCategoryLabel,
} from './PantheonCrawlerCapabilityMatrix';
import {
  acquirePantheonResource,
  runWithPantheonAcquisitionContext,
} from '../crawlers/PublicAcquisitionInfrastructure';
import { pantheonOrchestrator } from '../pantheonCrawlerOrchestrator';
import { twoStageDeployer } from './razors/TwoStageDeployer';
import { createPantheonDeadline } from './PantheonDeadline';

export type PantheonCapabilityHealthStatus = 'healthy' | 'degraded' | 'unavailable';
export type PantheonCapabilityOutcomeStatus =
  | 'not_applicable'
  | 'planned'
  | 'completed_with_evidence'
  | 'completed_no_evidence'
  | 'failed'
  | 'timed_out'
  | 'unavailable'
  | 'not_executed';

export interface PantheonCapabilityHealth {
  capabilityId: PantheonCapabilityId;
  status: PantheonCapabilityHealthStatus;
  checkedAt: string;
  durationMs: number;
  reason: string;
  fallbackCapabilityId?: PantheonCapabilityId;
}

export interface PantheonCapabilitySourceOutcome {
  sourceUrl: string;
  status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
  retrievedAt: string;
  durationMs: number;
  error?: string;
}

export interface PantheonCapabilityOutcome {
  capabilityId: PantheonCapabilityId;
  categoryLabel: PantheonReportCategoryLabel;
  applicable: boolean;
  status: PantheonCapabilityOutcomeStatus;
  attempts: number;
  evidenceCount: number;
  durationMs: number;
  sourceOutcomes: PantheonCapabilitySourceOutcome[];
  reason?: string;
  fallbackCapabilityId?: PantheonCapabilityId;
  fallbackExecuted?: boolean;
}

export interface PantheonCapabilityTelemetry {
  capabilityId: PantheonCapabilityId;
  attempts: number;
  completedWithEvidence: number;
  completedNoEvidence: number;
  failed: number;
  timedOut: number;
  unavailable: number;
  totalDurationMs: number;
  lastOutcomeAt?: string;
}

interface AuditLike {
  crawler: string;
  status: string;
  evidenceCount: number;
  attempts: number;
  targets: number;
  error?: string;
  durationMs?: number;
  sourceOutcomes?: PantheonCapabilitySourceOutcome[];
}

const telemetry = new Map<PantheonCapabilityId, PantheonCapabilityTelemetry>();

function isCapabilityId(value: string): value is PantheonCapabilityId {
  return Object.prototype.hasOwnProperty.call(PANTHEON_CRAWLER_CAPABILITY_MATRIX, value);
}

function auditHealthy(status: string): boolean {
  return status === 'completed_with_evidence' || status === 'completed_no_evidence';
}

function fallbackFor(
  capabilityId: PantheonCapabilityId,
  health: readonly PantheonCapabilityHealth[],
  categoryLabel?: string,
): PantheonCapabilityId | undefined {
  const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId];
  const healthy = new Set(
    health
      .filter(item => item.status !== 'unavailable')
      .map(item => item.capabilityId),
  );
  const categoryCandidates = categoryLabel
    ? getPantheonCategoryCapabilities(categoryLabel)
    : Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[];
  return categoryCandidates.find(candidate => {
    const candidateDescriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[candidate];
    return candidate !== capabilityId
      && healthy.has(candidate)
      && candidateDescriptor.capabilityClass === descriptor.capabilityClass
      && candidateDescriptor.taskKind === descriptor.taskKind;
  });
}

export async function runPantheonCapabilityHealthChecks(input: {
  investigationId: string;
  deadlineAt: number;
  probeUrl?: string;
}): Promise<PantheonCapabilityHealth[]> {
  const startedAt = Date.now();
  const probeUrl = input.probeUrl || 'https://www.usa.gov/';
  const healthDeadlineAt = Math.min(input.deadlineAt, startedAt + 12_000);
  const acquisition = await acquirePantheonResource(
    probeUrl,
    Math.max(1, healthDeadlineAt - Date.now()),
    {
      investigationId: input.investigationId,
      categoryId: input.investigationId + ':health',
      workId: input.investigationId + ':health:transport',
      capability: 'health-preflight',
      deadlineAt: healthDeadlineAt,
    },
  );

  if (!acquisition.ok || !acquisition.content.trim()) {
    const checkedAt = new Date().toISOString();
    return (Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[]).map(capabilityId => ({
      capabilityId,
      status: 'unavailable',
      checkedAt,
      durationMs: Date.now() - startedAt,
      reason: 'Canonical live-source preflight failed: ' + (acquisition.error || acquisition.errorType || acquisition.status),
    }));
  }

  const perFamilyBudgetMs = Math.max(1_500, Math.min(5_000, healthDeadlineAt - Date.now()));
  const healthDeadline = createPantheonDeadline(healthDeadlineAt);
  const [primaryRun, extendedRun] = await Promise.allSettled([
    runWithPantheonAcquisitionContext(
      {
        investigationId: input.investigationId,
        categoryId: input.investigationId + ':health',
        workId: input.investigationId + ':health:primary',
        capability: 'health-primary',
        deadlineAt: healthDeadlineAt,
      },
      healthDeadline.signal,
      () => pantheonOrchestrator.searchAllIsolatedWithAudit(
        [acquisition.url],
        {
          depth: 4,
          crawlers: [...PANTHEON_PRIMARY_CRAWLER_IDS],
          timeout: perFamilyBudgetMs,
          stormIntensity: 'flurry',
          signal: healthDeadline.signal,
        },
      ),
    ),
    runWithPantheonAcquisitionContext(
      {
        investigationId: input.investigationId,
        categoryId: input.investigationId + ':health',
        workId: input.investigationId + ':health:extended',
        capability: 'health-extended',
        deadlineAt: healthDeadlineAt,
      },
      healthDeadline.signal,
      () => twoStageDeployer.healthCheckAllCapabilities(acquisition.url, acquisition.content, perFamilyBudgetMs),
    ),
  ]);
  healthDeadline.dispose();

  const audits: AuditLike[] = [];
  if (primaryRun.status === 'fulfilled') audits.push(...primaryRun.value.audit);
  if (extendedRun.status === 'fulfilled') audits.push(...extendedRun.value);

  const checkedAt = new Date().toISOString();
  const health = (Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[]).map(capabilityId => {
    const audit = audits.find(item => item.crawler === capabilityId);
    if (!audit) {
      const familyFailure = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId].capabilityClass === 'primary-retrieval'
        ? primaryRun
        : extendedRun;
      return {
        capabilityId,
        status: 'unavailable' as const,
        checkedAt,
        durationMs: Date.now() - startedAt,
        reason: familyFailure.status === 'rejected'
          ? String(familyFailure.reason)
          : 'Capability produced no health-check outcome',
      };
    }
    const status: PantheonCapabilityHealthStatus = auditHealthy(audit.status)
      ? 'healthy'
      : audit.status === 'timed_out'
        ? 'degraded'
        : 'unavailable';
    return {
      capabilityId,
      status,
      checkedAt,
      durationMs: Number(audit.durationMs || 0),
      reason: audit.error || ('Live health check returned ' + audit.status),
    };
  });

  return health.map(item => item.status === 'unavailable'
    ? { ...item, fallbackCapabilityId: fallbackFor(item.capabilityId, health) }
    : item);
}

export function resolveHealthyPantheonPrimaryCapabilities(
  categoryLabel: string,
  health: readonly PantheonCapabilityHealth[],
): {
  requested: PantheonPrimaryCrawlerId[];
  selected: PantheonPrimaryCrawlerId[];
  fallbacks: Partial<Record<PantheonPrimaryCrawlerId, PantheonPrimaryCrawlerId>>;
} {
  const requested = getPantheonPrimaryCrawlerCapabilitiesForCategory(categoryLabel);
  const status = new Map(health.map(item => [item.capabilityId, item.status]));
  const selected: PantheonPrimaryCrawlerId[] = [];
  const fallbacks: Partial<Record<PantheonPrimaryCrawlerId, PantheonPrimaryCrawlerId>> = {};

  for (const capabilityId of requested) {
    if (status.get(capabilityId) !== 'unavailable') {
      selected.push(capabilityId);
      continue;
    }
    const fallback = fallbackFor(capabilityId, health, categoryLabel);
    if (fallback && (PANTHEON_PRIMARY_CRAWLER_IDS as readonly string[]).includes(fallback)) {
      fallbacks[capabilityId] = fallback as PantheonPrimaryCrawlerId;
      selected.push(fallback as PantheonPrimaryCrawlerId);
    }
  }

  return {
    requested,
    selected: [...new Set(selected)],
    fallbacks,
  };
}

function recordTelemetry(outcome: PantheonCapabilityOutcome): void {
  const current = telemetry.get(outcome.capabilityId) || {
    capabilityId: outcome.capabilityId,
    attempts: 0,
    completedWithEvidence: 0,
    completedNoEvidence: 0,
    failed: 0,
    timedOut: 0,
    unavailable: 0,
    totalDurationMs: 0,
  };
  current.attempts += outcome.attempts;
  current.totalDurationMs += outcome.durationMs;
  if (outcome.status === 'completed_with_evidence') current.completedWithEvidence += 1;
  if (outcome.status === 'completed_no_evidence') current.completedNoEvidence += 1;
  if (outcome.status === 'failed' || outcome.status === 'not_executed') current.failed += 1;
  if (outcome.status === 'timed_out') current.timedOut += 1;
  if (outcome.status === 'unavailable') current.unavailable += 1;
  current.lastOutcomeAt = new Date().toISOString();
  telemetry.set(outcome.capabilityId, current);
}

export function finalizePantheonCategoryCapabilityOutcomes(input: {
  categoryLabel: string;
  health: readonly PantheonCapabilityHealth[];
  crawlerAudit: readonly AuditLike[];
}): PantheonCapabilityOutcome[] {
  if (!(PANTHEON_REPORT_CATEGORY_LABELS as readonly string[]).includes(input.categoryLabel)) {
    throw new Error('Cannot finalize capability outcomes for unknown Pantheon category: ' + input.categoryLabel);
  }
  const categoryLabel = input.categoryLabel as PantheonReportCategoryLabel;
  const applicable = new Set(getPantheonCategoryCapabilities(categoryLabel));
  const healthById = new Map(input.health.map(item => [item.capabilityId, item]));
  const outcomes = (Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[]).map(capabilityId => {
    if (!applicable.has(capabilityId)) {
      return {
        capabilityId,
        categoryLabel,
        applicable: false,
        status: 'not_applicable' as const,
        attempts: 0,
        evidenceCount: 0,
        durationMs: 0,
        sourceOutcomes: [],
        reason: 'Capability is not permitted for this report category by the capability matrix',
      };
    }

    const health = healthById.get(capabilityId);
    const matching = input.crawlerAudit.filter(item => item.crawler === capabilityId);
    const attempts = matching.reduce((sum, item) => sum + Number(item.attempts || 0), 0);
    const evidenceCount = matching.reduce((sum, item) => sum + Number(item.evidenceCount || 0), 0);
    const durationMs = matching.reduce((sum, item) => sum + Number(item.durationMs || 0), 0);
    const sourceOutcomes = matching.flatMap(item => item.sourceOutcomes || []);
    const fallbackCapabilityId = health?.fallbackCapabilityId || fallbackFor(capabilityId, input.health, categoryLabel);
    const fallbackExecuted = Boolean(fallbackCapabilityId && input.crawlerAudit.some(item =>
      item.crawler === fallbackCapabilityId && Number(item.attempts || 0) > 0
    ));

    let status: PantheonCapabilityOutcomeStatus;
    let reason: string | undefined;
    if (health?.status === 'unavailable') {
      status = 'unavailable';
      reason = health.reason;
    } else if (evidenceCount > 0) {
      status = 'completed_with_evidence';
    } else if (matching.some(item => item.status === 'completed_no_evidence')) {
      status = 'completed_no_evidence';
    } else if (matching.some(item => item.status === 'timed_out')) {
      status = 'timed_out';
      reason = matching.find(item => item.status === 'timed_out')?.error;
    } else if (matching.some(item => item.status === 'failed')) {
      status = 'failed';
      reason = matching.find(item => item.status === 'failed')?.error;
    } else {
      status = 'not_executed';
      reason = 'Applicable capability received no attributable execution outcome';
    }

    return {
      capabilityId,
      categoryLabel,
      applicable: true,
      status,
      attempts,
      evidenceCount,
      durationMs,
      sourceOutcomes,
      reason,
      fallbackCapabilityId,
      fallbackExecuted,
    };
  });

  outcomes.forEach(recordTelemetry);
  return outcomes;
}

export function getPantheonCapabilityTelemetry(): PantheonCapabilityTelemetry[] {
  return (Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[]).map(capabilityId => ({
    capabilityId,
    attempts: telemetry.get(capabilityId)?.attempts || 0,
    completedWithEvidence: telemetry.get(capabilityId)?.completedWithEvidence || 0,
    completedNoEvidence: telemetry.get(capabilityId)?.completedNoEvidence || 0,
    failed: telemetry.get(capabilityId)?.failed || 0,
    timedOut: telemetry.get(capabilityId)?.timedOut || 0,
    unavailable: telemetry.get(capabilityId)?.unavailable || 0,
    totalDurationMs: telemetry.get(capabilityId)?.totalDurationMs || 0,
    lastOutcomeAt: telemetry.get(capabilityId)?.lastOutcomeAt,
  }));
}

export function assessPantheonCapabilityCoverage(
  categories: readonly { capabilityOutcomes?: readonly PantheonCapabilityOutcome[] }[],
): {
  eligible: boolean;
  executedCapabilities: PantheonCapabilityId[];
  missingCapabilities: PantheonCapabilityId[];
  undisclosedCapabilities: PantheonCapabilityId[];
} {
  const allOutcomes = categories.flatMap(category => category.capabilityOutcomes || []);
  const capabilityIds = Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[];
  const executedCapabilities = capabilityIds.filter(capabilityId => allOutcomes.some(outcome =>
    outcome.capabilityId === capabilityId
      && outcome.applicable
      && outcome.attempts > 0
      && (outcome.status === 'completed_with_evidence' || outcome.status === 'completed_no_evidence')
  ));
  const missingCapabilities = capabilityIds.filter(capabilityId => !executedCapabilities.includes(capabilityId));
  const undisclosedCapabilities = capabilityIds.filter(capabilityId => !allOutcomes.some(outcome =>
    outcome.capabilityId === capabilityId
  ));
  return {
    eligible: missingCapabilities.length === 0 && undisclosedCapabilities.length === 0,
    executedCapabilities,
    missingCapabilities,
    undisclosedCapabilities,
  };
}
