import { updatePantheonReportRecord } from './PantheonReportStore';
import { conductPantheonCategoryWorkflow, PANTHEON_REPORT_CATEGORIES } from './PantheonCategoryWorkflow';
import { canActivatePantheon } from '../pantheonCrawlerOrchestrator';
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
}

interface PersistedPantheonJob {
  state?: string;
  name?: string;
  location?: string;
  searchDepth?: number;
  completedCategories?: number;
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
    ...extra,
  };
}

async function runPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const startedAt = new Date();
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);
  const deadlineAt = new Date(startedAt.getTime() + budgetMs);

  await updatePantheonReportRecord(input.reportId, 'processing', {
    job: jobEnvelope(input, 'running', {
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
    }),
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

    const remainingCollectionMs = Math.max(0, deadlineAt.getTime() - Date.now());
    if (remainingCollectionMs <= 0) {
      throw new Error('PANTHEON investigation budget expired before collection could begin');
    }

    const { report, categoryOutcomes } = await conductPantheonCategoryWorkflow({
      name: input.name,
      location: input.location,
      searchDepth: input.searchDepth,
      deadlineAt: deadlineAt.getTime(),
      startCategoryIndex: input.resumeFromCategory,
      initialReport: input.initialReport,
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
          report: null,
        });
      },
      onCategoryComplete: async ({ index, label, completedCategories, outcome, partialReport }) => {
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
            categoryIndex: Math.min(index + 1, PANTHEON_REPORT_CATEGORIES.length - 1),
            categoryNumber: Math.min(index + 2, PANTHEON_REPORT_CATEGORIES.length),
            categoryName: PANTHEON_REPORT_CATEGORIES[Math.min(index + 1, PANTHEON_REPORT_CATEGORIES.length - 1)]?.label,
            completedCategories,
            totalCategories: PANTHEON_REPORT_CATEGORIES.length,
            lastCategoryOutcome: outcome,
          }),
          report: partialReport,
        });
      },
    });

    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'finalizing', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        finalizingAt: new Date().toISOString(),
      }),
      report,
      categoryOutcomes,
    });

    await updatePantheonReportRecord(input.reportId, 'completed', {
      job: jobEnvelope(input, 'completed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        completedAt: new Date().toISOString(),
      }),
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
  if (!name) return null;

  return startPantheonReportJob({
    reportId: report.id,
    userId: report.userId,
    name,
    location: job?.location || undefined,
    searchDepth: normalizePantheonSearchDepth(job?.searchDepth),
    resumeFromCategory: Math.max(0, Number(job?.completedCategories || 0)),
    initialReport: envelope.report,
  });
}
