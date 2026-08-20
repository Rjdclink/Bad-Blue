import { Cain, Reaper, type EdenscanResult, type ReaperAction } from './CainAndReaper';
import type { CrawlerSelectionPlan } from './CrawlerSelectionUtility';
import type { RetrievalEvidence } from './PantheonRetrievalAdapter';

export interface CrawlerSupervisionResult {
  cain: EdenscanResult;
  reaper: ReaperAction;
}

/** Executes Cain capacity scanning and Reaper integrity review around a retrieval run. */
export class CainReaperSupervisor {
  private readonly cain = new Cain();
  private readonly reaper = new Reaper();

  async supervise(
    plan: CrawlerSelectionPlan,
    evidence: RetrievalEvidence[]
  ): Promise<CrawlerSupervisionResult> {
    const successfulEvidence = evidence.filter(item => item.content.trim().length > 0);
    const cain = await this.cain.scanEden({
      id: `${plan.purpose}:${plan.createdAt}`,
      assumptions: plan.rationale.map(rationale => ({ resolved: rationale.length > 0 })),
      subsystems: plan.crawlers,
      trustDomains: [...new Set(evidence.map(item => item.target))],
      failureModes: evidence.filter(item => !item.content.trim()).map(item => item.crawler),
      telemetryConsistency: evidence.length === 0 ? 0 : successfulEvidence.length / evidence.length,
    });
    const reaper = await this.reaper.evaluate({
      crawlers: plan.crawlers,
      metrics: {
        perfection: evidence.length > 0 ? successfulEvidence.length / evidence.length : 0,
        activeTransformations: successfulEvidence.length,
        liveHypotheses: plan.crawlers.length,
        compressionCandidates: Math.max(0, evidence.length - successfulEvidence.length),
      },
      history: evidence.map(item => ({
        timestamp: new Date(item.retrievedAt).getTime(),
        type: item.content.trim() ? 'structural' : 'discard',
        pattern: item.crawler,
      })),
      timeWindow: 60_000,
    });
    return { cain, reaper };
  }
}

export const cainReaperSupervisor = new CainReaperSupervisor();