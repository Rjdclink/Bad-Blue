import { sql } from 'drizzle-orm';
import { db } from '../../db';

export interface PantheonDiscoveryLearningContext {
  categories?: readonly string[];
  jurisdiction?: string;
  crawler?: string;
  query?: string;
  latencyMs?: number;
}

let readyPromise: Promise<void> | null = null;
const memoryScores = new Map<string, number>();

function normalizedJurisdiction(value?: string): string {
  return String(value || '').trim().toUpperCase().slice(0, 80);
}

function normalizedCategory(values?: readonly string[]): string {
  return String(values?.[0] || 'general').trim().toLowerCase().slice(0, 80);
}

function normalizedHost(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; }
}

async function ensureLearningTable(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pantheon_discovery_learning (
          url TEXT NOT NULL,
          host TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          jurisdiction TEXT NOT NULL DEFAULT '',
          crawler TEXT NOT NULL DEFAULT '',
          query_pattern TEXT NOT NULL DEFAULT '',
          successes INTEGER NOT NULL DEFAULT 0,
          failures INTEGER NOT NULL DEFAULT 0,
          avg_latency_ms INTEGER NOT NULL DEFAULT 0,
          last_success_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (url, category, jurisdiction, crawler)
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS pantheon_discovery_learning_rank_idx
        ON pantheon_discovery_learning (category, jurisdiction, successes DESC, failures ASC, updated_at DESC)
      `);
    })().catch(error => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function rememberPantheonDiscoveryOutcome(
  url: string,
  success: boolean,
  context: PantheonDiscoveryLearningContext = {},
): Promise<void> {
  const host = normalizedHost(url);
  if (!host) return;
  const category = normalizedCategory(context.categories);
  const jurisdiction = normalizedJurisdiction(context.jurisdiction);
  const crawler = String(context.crawler || '').trim().slice(0, 80);
  const queryPattern = String(context.query || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
  const latencyMs = Math.max(0, Math.min(600_000, Math.round(context.latencyMs || 0)));
  memoryScores.set(host, (memoryScores.get(host) || 0) + (success ? 4 : -1));

  try {
    await ensureLearningTable();
    await db.execute(sql`
      INSERT INTO pantheon_discovery_learning
        (url, host, category, jurisdiction, crawler, query_pattern, successes, failures, avg_latency_ms, last_success_at, updated_at)
      VALUES
        (${url}, ${host}, ${category}, ${jurisdiction}, ${crawler}, ${queryPattern},
         ${success ? 1 : 0}, ${success ? 0 : 1}, ${latencyMs},
         ${success ? new Date() : null}, NOW())
      ON CONFLICT (url, category, jurisdiction, crawler)
      DO UPDATE SET
        successes = pantheon_discovery_learning.successes + ${success ? 1 : 0},
        failures = pantheon_discovery_learning.failures + ${success ? 0 : 1},
        avg_latency_ms = CASE
          WHEN ${latencyMs} <= 0 THEN pantheon_discovery_learning.avg_latency_ms
          WHEN pantheon_discovery_learning.avg_latency_ms <= 0 THEN ${latencyMs}
          ELSE ROUND((pantheon_discovery_learning.avg_latency_ms * 3 + ${latencyMs}) / 4.0)::INTEGER
        END,
        query_pattern = CASE WHEN ${queryPattern} = '' THEN pantheon_discovery_learning.query_pattern ELSE ${queryPattern} END,
        last_success_at = CASE WHEN ${success} THEN NOW() ELSE pantheon_discovery_learning.last_success_at END,
        updated_at = NOW()
    `);
  } catch {
    // Learning is advisory. Database unavailability must never block retrieval.
  }
}

export async function getPantheonLearnedSources(
  categories: readonly string[],
  jurisdiction?: string,
  limit = 8,
): Promise<string[]> {
  const category = normalizedCategory(categories);
  const normalizedLocation = normalizedJurisdiction(jurisdiction);
  try {
    await ensureLearningTable();
    const result: any = await db.execute(sql`
      SELECT url
      FROM pantheon_discovery_learning
      WHERE category = ${category}
        AND (jurisdiction = ${normalizedLocation} OR jurisdiction = '' OR ${normalizedLocation} = '')
        AND successes > 0
      ORDER BY
        (successes * 4 - failures * 2) DESC,
        CASE WHEN avg_latency_ms > 0 THEN avg_latency_ms ELSE 999999 END ASC,
        updated_at DESC
      LIMIT ${Math.max(1, Math.min(limit, 20))}
    `);
    const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
    return [...new Set(rows.map((row: any) => String(row?.url || '')).filter((url: string) => /^https?:\/\//i.test(url)))];
  } catch {
    return [];
  }
}

export function rankPantheonDiscoveryUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)].sort((left, right) => {
    const leftHost = normalizedHost(left);
    const rightHost = normalizedHost(right);
    return (memoryScores.get(rightHost) || 0) - (memoryScores.get(leftHost) || 0);
  });
}

export async function getPantheonLearnedQueryPatterns(
  categories: readonly string[],
  jurisdiction?: string,
  limit = 2,
): Promise<string[]> {
  const category = normalizedCategory(categories);
  const normalizedLocation = normalizedJurisdiction(jurisdiction);
  try {
    await ensureLearningTable();
    const result: any = await db.execute(sql`
      SELECT query_pattern
      FROM pantheon_discovery_learning
      WHERE category = ${category}
        AND (jurisdiction = ${normalizedLocation} OR jurisdiction = '' OR ${normalizedLocation} = '')
        AND successes > 0
        AND query_pattern <> ''
      GROUP BY query_pattern
      ORDER BY SUM(successes * 4 - failures * 2) DESC, MIN(NULLIF(avg_latency_ms, 0)) ASC NULLS LAST
      LIMIT ${Math.max(1, Math.min(limit, 4))}
    `);
    const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
    return [...new Set(rows.map((row: any) => String(row?.query_pattern || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}
