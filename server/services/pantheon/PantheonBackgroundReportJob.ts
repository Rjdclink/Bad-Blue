import {
  listRecoverablePantheonReportRecords,
  persistPantheonPdfArtifact,
  updatePantheonReportRecord,
} from './PantheonReportStore';
import {
  conductPantheonCategoryWorkflow,
  initializePantheonCategoryPlans,
  PANTHEON_REPORT_CATEGORIES,
  type PantheonCategoryOutcome,
  type PantheonPersistedCategoryState,
} from './PantheonCategoryWorkflow';
import {
  generatePantheonBackgroundReportPdf,
  verifyPantheonPdfBuffer,
} from './PantheonBackgroundReportPdf';
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
  resumeCategoryIndexes?: readonly number[];
  initialReport?: any;
  initialCategoryOutcomes?: readonly PantheonCategoryOutcome[];
  initialCategoryStates?: readonly PantheonPersistedCategoryState[];
  idempotencyKey: string;
  consent: { accepted: true; version: string; acceptedAt: string };
}

interface PersistedPantheonJob {
  state?: string;
  name?: string;
  location?: string;
  searchDepth?: number;
  completedCategories?: number;
  processedCategories?: number;
  idempotencyKey?: string;
  consent?: { accepted?: boolean; version?: string; acceptedAt?: string };
}

const activeJobs = new Map<string, Promise<void>>();

function jobEnvelope(input: PantheonReportJobInput, state: 'queued' | 'running' | 'finalizing' | 'completed' | 'partial' | 'failed', extra: Record<string, unknown> = {}) {
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

async function withStageDeadline<T>(label: string, timeoutMs: number, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Pantheon ${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const startedAt = new Date();
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);
  const deadlineAt = new Date(startedAt.getTime() + budgetMs);
  const initializedStates = initializePantheonCategoryPlans({
    name: input.name,
    location: input.location,
    searchDepth: input.searchDepth,
    budgetMs,
  });
  const categoryStates: PantheonPersistedCategoryState[] = input.initialCategoryStates?.length === PANTHEON_REPORT_CATEGORIES.length
    ? input.initialCategoryStates.map((state, index) => {
      const initialized = initializedStates[index];
      return state.state === 'completed'
        ? { ...state, sourcePlan: { ...state.sourcePlan } }
        : {
          ...initialized,
          outcome: state.outcome,
          state: 'pending' as const,
          phase: 'PENDING' as const,
        };
    })
    : initializedStates;
  const persistedOutcomes = () => categoryStates
    .flatMap(state => state.outcome ? [state.outcome] : [])
    .sort((left, right) => left.index - right.index);
  const processedCategoryCount = () => categoryStates.filter(state =>
    state.state === 'completed' || state.state === 'partial'
  ).length;
  const visibleCategory = (fallbackIndex: number) => {
    const state = categoryStates
      .filter(candidate => candidate.state === 'active')
      .sort((left, right) => left.index - right.index)[0]
      || categoryStates
        .filter(candidate => candidate.state === 'pending')
        .sort((left, right) => left.index - right.index)[0]
      || categoryStates[fallbackIndex];
    return state || { index: fallbackIndex, label: PANTHEON_REPORT_CATEGORIES[fallbackIndex]?.label || 'Report finalization' };
  };
  let latestPartialReport = input.initialReport || null;

  await updatePantheonReportRecord(input.reportId, 'processing', {
    job: jobEnvelope(input, 'running', {
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      completedCategories: persistedOutcomes().filter(outcome => outcome.completionState === 'completed').length,
      processedCategories: processedCategoryCount(),
      totalCategories: PANTHEON_REPORT_CATEGORIES.length,
    }),
    categoryStates,
    categoryOutcomes: persistedOutcomes(),
    report: latestPartialReport,
  });

  try {
    const availabilityDeadline = deadlineAt.getTime();
    while (!canActivatePantheon().available) {
      if (Date.now() >= availabilityDeadline) {
        throw new Error('PANTHEON remained unavailable for the entire investigation budget');
      }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }

    console.log('[PANTHEON REPORT JOB] capability preflight started', { reportId: input.reportId });
    const capabilityHealth = await runPantheonCapabilityHealthChecks({
      investigationId: input.reportId,
      deadlineAt: deadlineAt.getTime(),
    });
    console.log('[PANTHEON REPORT JOB] capability preflight completed', {
      reportId: input.reportId,
      checked: capabilityHealth.length,
      unavailable: capabilityHealth.filter(item => item.status === 'unavailable').length,
    });
    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'running', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        capabilityHealth,
        completedCategories: persistedOutcomes().filter(outcome => outcome.completionState === 'completed').length,
        processedCategories: processedCategoryCount(),
        totalCategories: PANTHEON_REPORT_CATEGORIES.length,
      }),
      categoryStates,
      categoryOutcomes: persistedOutcomes(),
      report: latestPartialReport,
    });

    const remainingCollectionMs = Math.max(0, deadlineAt.getTime() - Date.now());
    if (remainingCollectionMs <= 0) {
      throw new Error('PANTHEON investigation budget expired before collection could begin');
    }

    console.log('[PANTHEON REPORT JOB] category collection started', { reportId: input.reportId, categories: PANTHEON_REPORT_CATEGORIES.length });
    const { report, categoryOutcomes } = await conductPantheonCategoryWorkflow({
      investigationId: input.reportId,
      name: input.name,
      location: input.location,
      searchDepth: input.searchDepth,
      deadlineAt: deadlineAt.getTime(),
      startCategoryIndex: input.resumeFromCategory,
      categoryIndexes: input.resumeCategoryIndexes,
      initialReport: input.initialReport,
      initialCategoryOutcomes: input.initialCategoryOutcomes,
      initialCategoryStates: categoryStates,
      capabilityHealth,
      onCategoryState: async ({ index, label, phase }) => {
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
        // Start and completion callbacks are the durable checkpoints. Avoid a
        // remote/database write for every transient phase transition.
      },
      onCategoryStart: async ({ index, label }) => {
        const completedCategories = categoryStates.filter(state => state.state === 'completed').length;
        const visible = visibleCategory(index);
        console.log('[PANTHEON CATEGORY] start', { reportId: input.reportId, index: index + 1, label, completedCategories });
        await updatePantheonReportRecord(input.reportId, 'processing', {
          job: jobEnvelope(input, 'running', {
            startedAt: startedAt.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
            categoryIndex: visible.index,
            categoryNumber: visible.index + 1,
            categoryName: visible.label,
            completedCategories,
            processedCategories: processedCategoryCount(),
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
          }),
          categoryStates,
          categoryOutcomes: persistedOutcomes(),
          report: latestPartialReport,
        });
      },
      onCategoryComplete: async ({ index, label, outcome, partialReport }) => {
        latestPartialReport = partialReport;
        const categoryState = categoryStates[index];
        if (categoryState) {
          categoryState.outcome = outcome;
          categoryState.state = outcome.completionState === 'completed' ? 'completed' : 'partial';
          categoryState.phase = outcome.completionState === 'completed' ? 'COMPLETE' : 'PARTIAL';
        }
        const completedCategories = categoryStates.filter(state => state.state === 'completed').length;
        const visible = visibleCategory(index);
        const executedCapabilityCount = new Set(outcome.crawlerAudit
          .filter(entry => Number(entry.attempts || 0) > 0)
          .map(entry => entry.crawler)).size;
        console.log('[PANTHEON CATEGORY] outcome', {
          reportId: input.reportId,
          index: index + 1,
          label,
          state: outcome.completionState,
          completedCategories,
          evidenceCount: outcome.evidenceCount,
          executedCapabilityCount,
          successfulWorkCount: outcome.successfulWorkCount,
          requiredWorkCount: outcome.requiredWorkCount,
        });
        await updatePantheonReportRecord(input.reportId, 'processing', {
          job: jobEnvelope(input, 'running', {
            startedAt: startedAt.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
            // Persist the category that actually completed. The workflow
            // controller alone activates the next category afterward.
            categoryIndex: visible.index,
            categoryNumber: visible.index + 1,
            categoryName: visible.label,
            categoryPhase: 'PERSISTING',
            completedCategories,
            processedCategories: processedCategoryCount(),
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
            lastCategoryOutcome: outcome,
            categoryCursor: outcome.cursor,
            categoryLedgerVersion: outcome.ledgerVersion,
            categoryLedgerTotalUrls: outcome.totalLedgerUrls,
            categoryLedgerPendingUrls: outcome.pendingUrls,
            categoryUrlLedger: outcome.urlLedger,
          }),
          categoryStates,
          categoryOutcomes: persistedOutcomes(),
          report: partialReport,
        });
      },
    });
    console.log('[PANTHEON REPORT JOB] category collection closed', {
      reportId: input.reportId,
      processedCategories: categoryOutcomes.length,
    });

    const investigation = assessPantheonInvestigation(categoryOutcomes);
    Object.assign(report as any, {
      investigationStatus: investigation.state,
      investigationCoverage: investigation,
      searchDepthUsed: input.searchDepth,
      crawlersActivated: [...new Set((report.crawlerAudit || [])
        .filter((entry: any) => Number(entry.attempts || 0) > 0
          && Number(entry.targets || 0) > 0
          && ['completed_with_evidence', 'completed_no_evidence'].includes(String(entry.status || '')))
        .map((entry: any) => String(entry.crawler || ''))
        .filter(Boolean))],
    });
    latestPartialReport = report;
    const pdfCompletedAt = new Date();
    console.log('[PANTHEON REPORT JOB] PDF rendering started', { reportId: input.reportId });
    const pdfBuffer = await withStageDeadline('PDF rendering', 30_000, generatePantheonBackgroundReportPdf({
      reportId: input.reportId,
      report: report as any,
      job: {
        investigationStatus: investigation.state,
        searchDepth: input.searchDepth,
      },
      createdAt: startedAt,
      completedAt: pdfCompletedAt,
      categoryOutcomes,
    }));
    const pdfVerification = verifyPantheonPdfBuffer(pdfBuffer, 2);
    console.log('[PANTHEON REPORT JOB] PDF verified', { reportId: input.reportId, bytes: pdfVerification.bytes, sha256: pdfVerification.sha256 });
    const pdfArtifact = await withStageDeadline('PDF persistence', 20_000, persistPantheonPdfArtifact(input.reportId, pdfBuffer));
    if (pdfArtifact.sha256 !== pdfVerification.sha256 || pdfArtifact.bytes !== pdfVerification.bytes) {
      throw new Error('Persisted Pantheon PDF does not match the verified report artifact');
    }

    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'finalizing', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        finalizingAt: new Date().toISOString(),
        investigationStatus: investigation.state,
        completedCategories: investigation.completedCategoryCount,
        processedCategories: categoryOutcomes.length,
        partialCategories: investigation.partialCategoryCount,
        missingCrawlerCapabilities: investigation.missingCapabilities,
        capabilityCoverage: investigation.capabilityCoverage,
        capabilityTelemetry: getPantheonCapabilityTelemetry(),
        pdfVerification,
      }),
      categoryStates,
      report,
      categoryOutcomes,
      pdfVerification,
      pdfArtifact,
    });

    const finalStatus = investigation.releaseEligible ? 'completed' as const : 'partial' as const;
    await updatePantheonReportRecord(input.reportId, finalStatus, {
      job: jobEnvelope(input, finalStatus, {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        completedAt: pdfCompletedAt.toISOString(),
        investigationStatus: investigation.state,
        completedCategories: investigation.completedCategoryCount,
        processedCategories: categoryOutcomes.length,
        partialCategories: investigation.partialCategoryCount,
        missingCrawlerCapabilities: investigation.missingCapabilities,
        capabilityCoverage: investigation.capabilityCoverage,
        capabilityTelemetry: getPantheonCapabilityTelemetry(),
        pdfVerification,
      }),
      categoryStates,
      report,
      categoryOutcomes,
      pdfVerification,
      pdfArtifact,
    });
    console.log('[PANTHEON REPORT JOB] terminal report persisted', {
      reportId: input.reportId,
      status: finalStatus,
      processedCategories: categoryOutcomes.length,
      completedCategories: investigation.completedCategoryCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PANTHEON REPORT JOB] failed', { reportId: input.reportId, error: message.slice(0, 500) });
    await updatePantheonReportRecord(input.reportId, 'failed', {
      job: jobEnvelope(input, 'failed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        failedAt: new Date().toISOString(),
      }),
      categoryStates,
      categoryOutcomes: persistedOutcomes(),
      report: latestPartialReport,
    }, message.slice(0, 500));
  }
}

let recoveryWorkerStarted = false;
let recoveryTimer: ReturnType<typeof setInterval> | null = null;

export function startPantheonRecoveryWorker(): void {
  if (recoveryWorkerStarted) return;
  recoveryWorkerStarted = true;
  const recover = async () => {
    try {
      const records = await listRecoverablePantheonReportRecords();
      for (const record of records) {
        const resumed = resumePantheonReportJobFromRecord(record);
        if (resumed) void resumed.catch(error => console.error('[PANTHEON REPORT JOB] Recovery failed:', error));
      }
    } catch (error) {
      console.error('[PANTHEON REPORT JOB] Recovery scan failed:', error);
    }
  };
  void recover();
  recoveryTimer = setInterval(() => void recover(), 30_000);
  recoveryTimer.unref?.();
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
    ? report.reportData as {
      job?: PersistedPantheonJob;
      report?: any;
      categoryStates?: PantheonPersistedCategoryState[];
      categoryOutcomes?: PantheonCategoryOutcome[];
    }
    : {};
  const job = envelope.job;
  const name = String(job?.name || report.searchQuery || '').trim();
  const idempotencyKey = String(job?.idempotencyKey || '').trim();
  const consent = job?.consent;
  if (!name || !idempotencyKey || consent?.accepted !== true || !consent.version || !consent.acceptedAt) return null;

  const persistedStates = Array.isArray(envelope.categoryStates) ? envelope.categoryStates : [];
  const legacyCompletedCount = Math.max(0, Math.min(
    PANTHEON_REPORT_CATEGORIES.length,
    Number(job?.completedCategories || 0),
  ));
  const resumeCategoryIndexes = persistedStates.length === PANTHEON_REPORT_CATEGORIES.length
    ? persistedStates.filter(state => state.state !== 'completed').map(state => state.index)
    : Array.from(
      { length: PANTHEON_REPORT_CATEGORIES.length - legacyCompletedCount },
      (_, offset) => legacyCompletedCount + offset,
    );
  const initialCategoryOutcomes = [
    ...persistedStates.flatMap(state => state.outcome ? [state.outcome] : []),
    ...(Array.isArray(envelope.categoryOutcomes) ? envelope.categoryOutcomes : []),
  ].filter((outcome, position, values) =>
    values.findIndex(candidate => candidate.index === outcome.index) === position);

  return startPantheonReportJob({
    reportId: report.id,
    userId: report.userId,
    name,
    location: job?.location || undefined,
    searchDepth: normalizePantheonSearchDepth(job?.searchDepth),
    resumeCategoryIndexes,
    initialReport: envelope.report,
    initialCategoryOutcomes,
    initialCategoryStates: persistedStates,
    idempotencyKey,
    consent: { accepted: true, version: consent.version, acceptedAt: consent.acceptedAt },
  });
}
