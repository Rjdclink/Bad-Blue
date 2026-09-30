import { sql } from 'drizzle-orm';

export interface LexaraDiscoveryLearningContext {
  categories?: readonly string[];
  jurisdiction?: string;
  query?: string;
  latencyMs?: number;
  evidenceConfidence?: number;
  evidenceYield?: number;
}

let readyPromise: Promise<void> | null = null;
let databasePromise: Promise<typeof import('../db')> | null = null;
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

async function discoveryDatabase() {
  databasePromise ||= import('../db');
  return databasePromise;
}

async function ensureLearningTable(): Promise<void> {
  const { db } = await discoveryDatabase();
  if (!readyPromise) {
    readyPromise = db.execute(sql`
      CREATE TABLE IF NOT EXISTS public.lexara_discovery_learning (
        url TEXT NOT NULL,
        host TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        jurisdiction TEXT NOT NULL DEFAULT '',
        query_pattern TEXT NOT NULL DEFAULT '',
        successes INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms INTEGER NOT NULL DEFAULT 0,
        evidence_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
        evidence_yield INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (url, category, jurisdiction)
      )
    `).then(() => undefined).catch(error => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function rememberLexaraDiscoveryOutcome(
  url: string,
  success: boolean,
  context: LexaraDiscoveryLearningContext = {},
): Promise<void> {
  const host = normalizedHost(url);
  if (!host) return;
  const category = normalizedCategory(context.categories);
  const jurisdiction = normalizedJurisdiction(context.jurisdiction);
  const queryPattern = String(context.query || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
  const latencyMs = Math.max(0, Math.min(600_000, Math.round(context.latencyMs || 0)));
  const evidenceConfidence = Math.max(0, Math.min(1, Number(context.evidenceConfidence || 0)));
  const evidenceYield = Math.max(0, Math.min(1000, Math.round(context.evidenceYield || 0)));
  memoryScores.set(host, (memoryScores.get(host) || 0) + (success ? 4 : -1));

  try {
    const { db } = await discoveryDatabase();
    await ensureLearningTable();
    await db.execute(sql`
      INSERT INTO public.lexara_discovery_learning
        (url, host, category, jurisdiction, query_pattern, successes, failures, avg_latency_ms, evidence_confidence, evidence_yield, updated_at)
      VALUES
        (${url}, ${host}, ${category}, ${jurisdiction}, ${queryPattern},
         ${success ? 1 : 0}, ${success ? 0 : 1}, ${latencyMs}, ${evidenceConfidence}, ${evidenceYield}, NOW())
      ON CONFLICT (url, category, jurisdiction)
      DO UPDATE SET
        successes = lexara_discovery_learning.successes + ${success ? 1 : 0},
        failures = lexara_discovery_learning.failures + ${success ? 0 : 1},
        avg_latency_ms = CASE
          WHEN ${latencyMs} <= 0 THEN lexara_discovery_learning.avg_latency_ms
          WHEN lexara_discovery_learning.avg_latency_ms <= 0 THEN ${latencyMs}
          ELSE ROUND((lexara_discovery_learning.avg_latency_ms * 3 + ${latencyMs}) / 4.0)::INTEGER
        END,
        query_pattern = CASE WHEN ${queryPattern} = '' THEN lexara_discovery_learning.query_pattern ELSE ${queryPattern} END,
        evidence_confidence = GREATEST(lexara_discovery_learning.evidence_confidence, ${evidenceConfidence}),
        evidence_yield = lexara_discovery_learning.evidence_yield + ${evidenceYield},
        updated_at = NOW()
    `);
  } catch {
    // Learning is advisory and never blocks research.
  }
}

export async function getLexaraLearnedSources(
  categories: readonly string[],
  jurisdiction?: string,
  limit = 8,
): Promise<string[]> {
  const category = normalizedCategory(categories);
  const normalizedLocation = normalizedJurisdiction(jurisdiction);
  try {
    const { db } = await discoveryDatabase();
    await ensureLearningTable();
    const result: any = await db.execute(sql`
      SELECT url
      FROM public.lexara_discovery_learning
      WHERE (jurisdiction = ${normalizedLocation} OR jurisdiction = '' OR ${normalizedLocation} = '')
        AND successes > 0
      ORDER BY
        CASE WHEN category = ${category} THEN 1 ELSE 0 END DESC,
        (successes * 4 - failures * 2 + evidence_yield * 2 + ROUND(evidence_confidence * 8)) DESC,
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

export async function getLexaraLearnedQueryPatterns(
  categories: readonly string[],
  jurisdiction?: string,
  limit = 2,
): Promise<string[]> {
  const category = normalizedCategory(categories);
  const normalizedLocation = normalizedJurisdiction(jurisdiction);
  try {
    const { db } = await discoveryDatabase();
    await ensureLearningTable();
    const result: any = await db.execute(sql`
      SELECT query_pattern
      FROM public.lexara_discovery_learning
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

export function rankLexaraDiscoveryUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)].sort((left, right) =>
    (memoryScores.get(normalizedHost(right)) || 0) - (memoryScores.get(normalizedHost(left)) || 0));
}
