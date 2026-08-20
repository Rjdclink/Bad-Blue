export type ExecutableCrawler =
  | 'startrek'
  | 'birdofprey'
  | 'sixdegrees'
  | 'cerberus'
  | 'blizzard'
  | 'lich';

export type CrawlerSelectionPurpose =
  | 'background_report'
  | 'criminal_source_discovery'
  | 'lexara_legal_research'
  | 'map_evidence_render';

export type CrawlerSupervisor = 'cain' | 'reaper';

export interface CrawlerSelectionRequest {
  purpose: CrawlerSelectionPurpose;
  depth?: 1 | 2 | 3 | 4;
  targetCount: number;
  host?: string;
}

export interface CrawlerSelectionPlan {
  purpose: CrawlerSelectionPurpose;
  depth: 1 | 2 | 3 | 4;
  crawlers: ExecutableCrawler[];
  supervisors: CrawlerSupervisor[];
  executionRequired: boolean;
  rationale: string[];
  createdAt: string;
}

interface CrawlerOutcome {
  attempts: number;
  successes: number;
  totalConfidence: number;
}

const outcomes = new Map<ExecutableCrawler, CrawlerOutcome>();

const DEPTH_CRAWLERS: Record<1 | 2 | 3 | 4, ExecutableCrawler[]> = {
  1: ['startrek'],
  2: ['startrek', 'birdofprey', 'sixdegrees'],
  3: ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard'],
  4: ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich'],
};

const PURPOSE_BASELINES: Record<Exclude<CrawlerSelectionPurpose, 'map_evidence_render'>, ExecutableCrawler[]> = {
  background_report: DEPTH_CRAWLERS[4],
  criminal_source_discovery: DEPTH_CRAWLERS[4],
  lexara_legal_research: DEPTH_CRAWLERS[4],
};

function outcomeScore(crawler: ExecutableCrawler): number {
  const outcome = outcomes.get(crawler);
  if (!outcome || outcome.attempts === 0) return 0.5;
  const successRate = outcome.successes / outcome.attempts;
  const averageConfidence = outcome.totalConfidence / outcome.attempts;
  return (successRate * 0.7) + (averageConfidence * 0.3);
}

/**
 * Select only crawlers compatible with the current workload. The plan is
 * explainable and continuously adjusted from real orchestrator outcomes.
 */
export function selectCrawlerPlan(request: CrawlerSelectionRequest): CrawlerSelectionPlan {
  const depth = request.depth || 4;
  const createdAt = new Date().toISOString();

  if (request.purpose === 'map_evidence_render') {
    return {
      purpose: request.purpose,
      depth,
      crawlers: [],
      supervisors: [],
      executionRequired: false,
      rationale: ['Maps render collected evidence and do not initiate crawling automatically.'],
      createdAt,
    };
  }

  const baseline = PURPOSE_BASELINES[request.purpose];
  const permitted = baseline.filter(crawler => DEPTH_CRAWLERS[depth].includes(crawler));
  const crawlers = [...permitted].sort((left, right) => outcomeScore(right) - outcomeScore(left));
  const hostHint = request.host ? ` Target host: ${request.host}.` : '';

  return {
    purpose: request.purpose,
    depth,
    crawlers,
    supervisors: ['cain', 'reaper'],
    executionRequired: true,
    rationale: [
      `Selected ${crawlers.length} crawler(s) for ${request.purpose.replace(/_/g, ' ')}.`,
      'Ordering uses observed success rate and average result confidence from completed runs.',
      `Target count: ${request.targetCount}.${hostHint}`,
    ],
    createdAt,
  };
}

export function recordCrawlerOutcomes(results: Array<{ crawler: string; confidence: number; content?: string }>): void {
  for (const result of results) {
    if (!isExecutableCrawler(result.crawler)) continue;
    const current = outcomes.get(result.crawler) || { attempts: 0, successes: 0, totalConfidence: 0 };
    current.attempts += 1;
    current.successes += result.content?.trim() ? 1 : 0;
    current.totalConfidence += Number.isFinite(result.confidence) ? result.confidence : 0;
    outcomes.set(result.crawler, current);
  }
}

export function getCrawlerSelectionMetrics(): Record<ExecutableCrawler, CrawlerOutcome> {
  return Object.fromEntries(
    (Object.keys(DEPTH_CRAWLERS[4]) as ExecutableCrawler[]).map(crawler => [
      crawler,
      outcomes.get(crawler) || { attempts: 0, successes: 0, totalConfidence: 0 },
    ])
  ) as Record<ExecutableCrawler, CrawlerOutcome>;
}

function isExecutableCrawler(crawler: string): crawler is ExecutableCrawler {
  return (DEPTH_CRAWLERS[4] as string[]).includes(crawler);
}