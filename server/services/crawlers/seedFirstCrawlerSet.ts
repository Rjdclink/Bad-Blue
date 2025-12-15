/**
 * Seed-first crawler set (crawl-only)
 *
 * Requirements:
 * - Exactly 4 crawlers
 * - Deterministic
 * - Single-URL fetch only (each crawler fetches the seed URL exactly once)
 * - No cross-site hopping, no discovery expansion, no randomness
 * - Sequential fallback: crawler[0] → crawler[3], stop on first success
 */
export interface SeedFirstCrawlerResult {
  title?: string;
  textSnippet?: string;
  emails: string[];
  phones: string[];
  links: string[];
  coordinates: { lat: number; lng: number }[];
  itemsFound: number;
  timedOut: boolean;
}

export interface SeedFirstCrawler {
  name: string;
  crawlSeed: (seedUrl: string, timeoutMs: number) => Promise<SeedFirstCrawlerResult>;
}

export { SeedFetchStarTrek } from './seedFirst/SeedFetchStarTrek.ts';
export { SeedFetchBirdOfPrey } from './seedFirst/SeedFetchBirdOfPrey.ts';
export { SeedFetchSixDegrees } from './seedFirst/SeedFetchSixDegrees.ts';
export { SeedFetchTrinity } from './seedFirst/SeedFetchTrinity.ts';

import { SeedFetchStarTrek } from './seedFirst/SeedFetchStarTrek.ts';
import { SeedFetchBirdOfPrey } from './seedFirst/SeedFetchBirdOfPrey.ts';
import { SeedFetchSixDegrees } from './seedFirst/SeedFetchSixDegrees.ts';
import { SeedFetchTrinity } from './seedFirst/SeedFetchTrinity.ts';

export const SEED_FIRST_CRAWLERS: readonly SeedFirstCrawler[] = [
  SeedFetchStarTrek,
  SeedFetchBirdOfPrey,
  SeedFetchSixDegrees,
  SeedFetchTrinity,
] as const;

