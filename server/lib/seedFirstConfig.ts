/**
 * PHASE 1 — CONFIGURATION LOCK
 *
 * Hard-locked constants.
 * - No environment overrides
 * - No dynamic scaling
 */

export const MAX_SEEDS_PER_JOB = 25 as const;
export const MAX_CRAWLERS_PER_SEED = 4 as const;

// Fixed global timeout per seed.
export const GLOBAL_SEED_TIMEOUT_MS = 15_000 as const;

// Content threshold (Firecrawl + Puppeteer success criteria)
export const MIN_CONTENT_LENGTH = 200 as const;

// Fixed crawler set (do not add/remove)
export const PERMITTED_CRAWLER_NAMES = [
  'SeedFetchStarTrek',
  'SeedFetchBirdOfPrey',
  'SeedFetchTrinity',
  'SeedFetchSixDegrees',
] as const;

export type PermittedCrawlerName = typeof PERMITTED_CRAWLER_NAMES[number];

// SixDegrees is present but DISABLED by default.
export const DEFAULT_DISABLED_CRAWLERS: readonly PermittedCrawlerName[] = [
  'SeedFetchSixDegrees',
] as const;

// Locked execution order per seed.
export const CRAWLER_EXECUTION_ORDER: readonly PermittedCrawlerName[] = [
  'SeedFetchStarTrek', // Firecrawl fast-path
  'SeedFetchBirdOfPrey', // Puppeteer fallback
  'SeedFetchTrinity',
  'SeedFetchSixDegrees',
] as const;
