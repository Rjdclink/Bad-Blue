import {
  canActivatePantheon,
  pantheonOrchestrator,
  type CrawlerResult,
} from '../pantheonCrawlerOrchestrator';
import {
  recordCrawlerOutcomes,
  selectCrawlerPlan,
  type CrawlerSelectionPlan,
  type CrawlerSelectionPurpose,
} from './CrawlerSelectionUtility';
import { cainReaperSupervisor, type CrawlerSupervisionResult } from './CainReaperSupervisor';

export interface RetrievalEvidence {
  crawler: string;
  target: string;
  content: string;
  confidence: number;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PantheonRetrievalResponse {
  available: boolean;
  reason?: string;
  plan: CrawlerSelectionPlan;
  evidence: RetrievalEvidence[];
  supervision?: CrawlerSupervisionResult;
}

/** Normalizes results from every executable PANTHEON crawler into provenance-bearing evidence. */
export class PantheonRetrievalAdapter {
  async retrieve(request: {
    purpose: Exclude<CrawlerSelectionPurpose, 'map_evidence_render'>;
    targets: string[];
    depth?: 1 | 2 | 3 | 4;
  }): Promise<PantheonRetrievalResponse> {
    const firstTarget = request.targets[0];
    const host = firstTarget ? new URL(firstTarget).host : undefined;
    const plan = selectCrawlerPlan({
      purpose: request.purpose,
      depth: request.depth || 4,
      targetCount: request.targets.length,
      host,
    });
    const availability = canActivatePantheon();
    if (!availability.available) {
      return { available: false, reason: availability.reason, plan, evidence: [] };
    }

    const results = await pantheonOrchestrator.search(request.targets, {
      depth: plan.depth,
      crawlers: plan.crawlers,
      stormIntensity: plan.depth === 4 ? 'storm' : 'snow',
    });
    recordCrawlerOutcomes(results);

    const evidence = results.map(normalizeResult);
    return {
      available: true,
      plan,
      evidence,
      supervision: await cainReaperSupervisor.supervise(plan, evidence),
    };
  }
}

function normalizeResult(result: CrawlerResult): RetrievalEvidence {
  return {
    crawler: result.crawler,
    target: result.target,
    content: result.content,
    confidence: result.confidence,
    retrievedAt: new Date(result.timestamp).toISOString(),
    metadata: result.metadata,
  };
}

export const pantheonRetrievalAdapter = new PantheonRetrievalAdapter();