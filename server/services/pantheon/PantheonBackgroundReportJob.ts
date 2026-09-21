import { updatePantheonReportRecord } from './PantheonReportStore';
import {
  conductPantheonCategoryWorkflow,
  initializePantheonCategoryPlans,
  PANTHEON_REPORT_CATEGORIES,
} from './PantheonCategoryWorkflow';
import { assessPantheonInvestigation } from './PantheonInvestigationController';
import { canActivatePantheon } from '../pantheonCrawlerOrchestrator';
import {
  getPantheonCapabilityTelemetry,
  runPantheonCapabilityHealthChecks,
} from './PantheonCapabilityRuntime';
import {
  getPantheonReportDurationMs,
  normalizePantheonSearchDepth,
  type PantheonSearchDepth,
} from '@shared/pantheonReportConfig';

export interface PantheonReportJobInput {
  reportId: string;
  userId: string;
  name: string;
  location?: string;
  searchDepth: PantheonSearchDepth;
  resumeFromCategory?: number;
  initialReport?: any;
  idempotencyKey: string;
  consent: { accepted: true; version: string; acceptedAt: string };
}

interface PersistedPantheonJob {
  state?: string;
  name?: string;
  location?: string;
  searchDepth?: number;
  completedCategories?: number;
  idempotencyKey?: string;
  consent?: { accepted?: boolean; version?: string; acceptedAt?: string };
}

const activeJobs = new Map<string, Promise<void>>();

function jobEnvelope(input: PantheonReportJobInput, state: 'queued' | 'running' | 'finalizing' | 'completed' | 'failed', extra: Record<string, unknown> = {}) {
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);
  return {
    state,
    name: input.name,
    location: input.location || null,
    searchDepth: input.searchDepth,
    budgetMs,
    idempotencyKey: input.idempotencyKey,
    consent: input.consent,
    ...extra,
  };
}

async function runPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const startedAt = new Date();
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);
  const deadlineAt = new Date(startedAt.getTime() + budgetMs);
  const categoryStates = initializePantheonCategoryPlans({
    name: input.name,
    location: input.location,
    searchDepth: input.searchDepth,
    budgetMs,
  });

  await updatePantheonReportRecord(input.reportId, 'processing', {
    job: jobEnvelope(input, 'running', {
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
    }),
    categoryStates,
    report: null,
  });

  try {
    const availabilityDeadline = deadlineAt.getTime();
    while (!canActivatePantheon().available) {
      if (Date.now() >= availabilityDeadline) {
        throw new Error('PANTHEON remained unavailable for the entire investigation budget');
      }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }

    const capabilityHealth = await runPantheonCapabilityHealthChecks({
      investigationId: input.reportId,
      deadlineAt: deadlineAt.getTime(),
    });
    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'running', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        capabilityHealth,
      }),
      categoryStates,
      report: null,
    });

    const remainingCollectionMs = Math.max(0, deadlineAt.getTime() - Date.now());
    if (remainingCollectionMs <= 0) {
      throw new Error('PANTHEON investigation budget expired before collection could begin');
    }

    let latestPartialReport = input.initialReport || null;
    const { report, categoryOutcomes } = await conductPantheonCategoryWorkflow({
      investigationId: input.reportId,
      name: input.name,
      location: input.location,
      searchDepth: input.searchDepth,
      deadlineAt: deadlineAt.getTime(),
      startCategoryIndex: input.resumeFromCategory,
      initialReport: input.initialReport,
      capabilityHealth,
      onCategoryState: async ({ index, label, phase, completedCategories }) => {
        const categoryState = categoryStates[index];
        if (categoryState) {
          categoryState.phase = phase;
          categoryState.state = phase === 'COMPLETE'
            ? 'completed'
            : phase === 'PARTIAL'
              ? 'partial'
              : phase === 'PENDING'
                ? 'pending'
                : 'active';
        }
        await updatePantheonReportRecord(input.reportId, 'processing', {
          job: jobEnvelope(input, phase === 'PERSISTING' ? 'finalizing' : 'running', {
            startedAt: startedAt.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
            categoryIndex: index,
            categoryNumber: index + 1,
            categoryName: label,
            categoryPhase: phase,
            completedCategories,
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
          }),
          categoryStates,
          report: latestPartialReport,
        });
      },
      onCategoryStart: async ({ index, label, completedCategories }) => {
        console.log('[PANTHEON CATEGORY] start', { reportId: input.reportId, index: index + 1, label, completedCategories });
        await updatePantheonReportRecord(input.reportId, 'processing', {
          job: jobEnvelope(input, 'running', {
            startedAt: startedAt.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
            categoryIndex: index,
            categoryNumber: index + 1,
            categoryName: label,
            completedCategories,
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
          }),
          categoryStates,
          report: latestPartialReport,
        });
      },
      onCategoryComplete: async ({ index, label, completedCategories, outcome, partialReport }) => {
        latestPartialReport = partialReport;
        const categoryState = categoryStates[index];
        if (categoryState) {
          categoryState.outcome = outcome;
          categoryState.state = outcome.completionState === 'completed' ? 'completed' : 'partial';
          categoryState.phase = outcome.completionState === 'completed' ? 'COMPLETE' : 'PARTIAL';
        }
        console.log('[PANTHEON CATEGORY] complete', {
          reportId: input.reportId,
          index: index + 1,
          label,
          completedCategories,
          evidenceCount: outcome.evidenceCount,
          crawlerOutcomes: outcome.crawlerAudit.length,
        });
        await updatePantheonReportRecord(input.reportId, 'processing', {
          job: jobEnvelope(input, 'running', {
            startedAt: startedAt.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
            // Persist the category that actually completed. The workflow
            // controller alone activates the next category afterward.
            categoryIndex: index,
            categoryNumber: index + 1,
            categoryName: label,
            categoryPhase: 'PERSISTING',
            completedCategories,
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
            lastCategoryOutcome: outcome,
            categoryCursor: outcome.cursor,
            categoryLedgerVersion: outcome.ledgerVersion,
            categoryLedgerTotalUrls: outcome.totalLedgerUrls,
            categoryLedgerPendingUrls: outcome.pendingUrls,
            categoryUrlLedger: outcome.urlLedger,
          }),
          categoryStates,
          report: partialReport,
        });
      },
    });

    const investigation = assessPantheonInvestigation(categoryOutcomes);
    Object.assign(report as any, {
      investigationStatus: investigation.state,
      investigationCoverage: investigation,
    });

    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'finalizing', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        finalizingAt: new Date().toISOString(),
        investigationStatus: investigation.state,
        completedCategories: investigation.completedCategoryCount,
        partialCategories: investigation.partialCategoryCount,
        missingCrawlerCapabilities: investigation.missingCapabilities,
        capabilityCoverage: investigation.capabilityCoverage,
        capabilityTelemetry: getPantheonCapabilityTelemetry(),
      }),
      categoryStates,
      report,
      categoryOutcomes,
    });

    await updatePantheonReportRecord(input.reportId, 'completed', {
      job: jobEnvelope(input, 'completed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        completedAt: new Date().toISOString(),
        investigationStatus: investigation.state,
        completedCategories: investigation.completedCategoryCount,
        partialCategories: investigation.partialCategoryCount,
        missingCrawlerCapabilities: investigation.missingCapabilities,
        capabilityCoverage: investigation.capabilityCoverage,
        capabilityTelemetry: getPantheonCapabilityTelemetry(),
      }),
      categoryStates,
      report,
      categoryOutcomes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updatePantheonReportRecord(input.reportId, 'failed', {
      job: jobEnvelope(input, 'failed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        failedAt: new Date().toISOString(),
      }),
      categoryStates,
      report: null,
    }, message.slice(0, 500));
  }
}

export function startPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const existing = activeJobs.get(input.reportId);
  if (existing) return existing;

  const job = runPantheonReportJob(input)
    .finally(() => activeJobs.delete(input.reportId));

  activeJobs.set(input.reportId, job);
  return job;
}

export function isPantheonReportJobActive(reportId: string): boolean {
  return activeJobs.has(reportId);
}

export function resumePantheonReportJobFromRecord(report: {
  id: string;
  userId: string;
  status: string;
  searchQuery: string;
  reportData: unknown;
}): Promise<void> | null {
  if (report.status !== 'processing' || isPantheonReportJobActive(report.id)) return null;

  const envelope = (report.reportData && typeof report.reportData === 'object')
    ? report.reportData as { job?: PersistedPantheonJob; report?: any }
    : {};
  const job = envelope.job;
  const name = String(job?.name || report.searchQuery || '').trim();
  const idempotencyKey = String(job?.idempotencyKey || '').trim();
  const consent = job?.consent;
  if (!name || !idempotencyKey || consent?.accepted !== true || !consent.version || !consent.acceptedAt) return null;

  return startPantheonReportJob({
    reportId: report.id,
    userId: report.userId,
    name,
    location: job?.location || undefined,
    searchDepth: normalizePantheonSearchDepth(job?.searchDepth),
    resumeFromCategory: Math.max(0, Number(job?.completedCategories || 0)),
    initialReport: envelope.report,
    idempotencyKey,
    consent: { accepted: true, version: consent.version, acceptedAt: consent.acceptedAt },
  });
}