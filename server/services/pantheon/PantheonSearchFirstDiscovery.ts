import {
  discoverPantheonSourcesParallel,
  type PantheonDiscoveryEvidence,
} from './PantheonDiscoveryCoordinator';

export interface PantheonSearchFirstCategory {
  label: string;
  registry: readonly string[];
}

export interface PantheonSearchFirstCandidate extends PantheonDiscoveryEvidence {
  categoryIndexes: number[];
  discoveryQuery: string;
}

function tokens(value: string): string[] {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4);
}

function categoryScore(
  candidate: PantheonDiscoveryEvidence,
  category: PantheonSearchFirstCategory,
): number {
  const haystack = `${candidate.title || ''} ${candidate.snippet || ''} ${candidate.url}`.toLowerCase();
  const categoryTokens = [...new Set(tokens(`${category.label} ${category.registry.join(' ')}`))];
  return categoryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function classifyCandidate(
  candidate: PantheonDiscoveryEvidence,
  categories: readonly PantheonSearchFirstCategory[],
): number[] {
  const ranked = categories
    .map((category, index) => ({ index, score: categoryScore(candidate, category) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 4)
    .map(item => item.index);
  // Every discovered subject page participates in identity resolution even if
  // its search metadata does not yet reveal a more specific report category.
  return [...new Set([0, ...ranked])];
}

export async function discoverPantheonSearchFirstCandidates(input: {
  name: string;
  location?: string;
  categories: readonly PantheonSearchFirstCategory[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PantheonSearchFirstCandidate[]> {
  const subject = input.name.trim();
  const location = input.location?.trim();
  const locationClause = location ? ` ${location}` : '';
  const queries = [
    `"${subject}"${locationClause}`,
    `"${subject}"${locationClause} public records court employment license property news`,
    `"${subject}"${locationClause} government professional social business address`,
  ];
  const perQueryTimeout = Math.max(900, Math.min(input.timeoutMs || 2_500, 5_000));
  const settled = await Promise.all(queries.map(async discoveryQuery => {
    const result = await discoverPantheonSourcesParallel(discoveryQuery, [], {
      categories: input.categories.flatMap(category => category.registry),
      jurisdiction: location,
      limit: 24,
      timeoutMs: perQueryTimeout,
      signal: input.signal,
      includePaidFallback: false,
    });
    return result.evidence.map(candidate => ({
      ...candidate,
      categoryIndexes: classifyCandidate(candidate, input.categories),
      discoveryQuery,
    }));
  }));
  const byUrl = new Map<string, PantheonSearchFirstCandidate>();
  for (const candidate of settled.flat()) {
    const existing = byUrl.get(candidate.url);
    if (!existing) {
      byUrl.set(candidate.url, candidate);
      continue;
    }
    existing.categoryIndexes = [...new Set([...existing.categoryIndexes, ...candidate.categoryIndexes])];
    if (!existing.title && candidate.title) existing.title = candidate.title;
    if (!existing.snippet && candidate.snippet) existing.snippet = candidate.snippet;
  }
  return [...byUrl.values()];
}

export function candidatesForPantheonCategory(
  candidates: readonly PantheonSearchFirstCandidate[],
  categoryIndex: number,
): PantheonSearchFirstCandidate[] {
  return candidates.filter(candidate => candidate.categoryIndexes.includes(categoryIndex));
}


export async function discoverPantheonCategoryGapCandidates(input: {
  name: string;
  location?: string;
  category: PantheonSearchFirstCategory;
  categoryIndex: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PantheonSearchFirstCandidate[]> {
  const locationClause = input.location?.trim() ? ` ${input.location.trim()}` : '';
  const discoveryQuery = `"${input.name.trim()}"${locationClause} ${input.category.label} ${input.category.registry.join(' ')} official records`;
  const result = await discoverPantheonSourcesParallel(discoveryQuery, [], {
    categories: input.category.registry,
    jurisdiction: input.location,
    limit: 16,
    timeoutMs: Math.max(750, Math.min(input.timeoutMs || 1_500, 3_000)),
    signal: input.signal,
    includePaidFallback: false,
  });
  return result.evidence.map(candidate => ({
    ...candidate,
    categoryIndexes: [...new Set([0, input.categoryIndex])],
    discoveryQuery,
  }));
}
