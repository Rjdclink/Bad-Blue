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
  discoveryLanes?: string[];
}

function tokens(value: string): string[] {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4);
}

const CATEGORY_DISCOVERY_HINTS: Record<string, readonly string[]> = {
  'Phone Numbers': ['phone', 'telephone', 'mobile', 'contact'],
  'Email Addresses': ['email', 'e-mail', 'contact'],
  'Current Address': ['address', 'residence', 'resident', 'property'],
  'Address History': ['address', 'residence', 'former', 'previous'],
  'Relatives & Family': ['relative', 'family', 'spouse', 'parent', 'sibling', 'probate'],
  'Associates & Household Connections': ['associate', 'household', 'connection', 'relationship'],
  'Social-Media Profiles': ['social', 'profile', 'facebook', 'linkedin', 'instagram', 'twitter'],
  'Usernames & Online Accounts': ['username', 'handle', 'account', 'profile'],
  'Photos & Public Images': ['photo', 'image', 'picture', 'gallery'],
  'Employment History': ['employment', 'employee', 'employer', 'work', 'career', 'salary'],
  'Education': ['education', 'school', 'college', 'university', 'graduate'],
  'Professional Licenses & Credentials': ['license', 'licensure', 'credential', 'certification', 'board'],
  'Business Ownership & Affiliations': ['business', 'company', 'corporation', 'llc', 'officer', 'director'],
  'Property & Real Estate': ['property', 'parcel', 'real estate', 'assessor', 'deed'],
  'Vehicles & Transportation Records': ['vehicle', 'transportation', 'motor', 'driver'],
  'Court Records': ['court', 'case', 'docket', 'lawsuit', 'litigation'],
  'Criminal Records': ['criminal', 'charge', 'conviction', 'offense', 'court'],
  'Arrest & Police Records': ['arrest', 'police', 'sheriff', 'booking'],
  'Incarceration & Corrections': ['inmate', 'prison', 'correction', 'custody'],
  'Probation & Parole Information': ['probation', 'parole', 'supervision'],
  'Warrants & Wanted-Person Records': ['warrant', 'wanted', 'fugitive'],
  'Sex-Offender Registries': ['sex offender', 'offender registry', 'registry'],
  'Civil Litigation & Judgments': ['civil', 'lawsuit', 'judgment', 'litigation'],
  'Bankruptcies, Liens & Financial Public Records': ['bankruptcy', 'lien', 'judgment', 'ucc'],
  'Marriage, Divorce & Vital-Record Information': ['marriage', 'divorce', 'vital', 'spouse', 'probate'],
  'News & Media Mentions': ['news', 'media', 'press', 'article'],
  'Internet & Web Footprint': ['website', 'web', 'profile', 'domain', 'internet'],
  'Government, Political & Public-Service Records': ['government', 'campaign', 'lobby', 'public service', 'contract'],
  'Relationship & Timeline Intelligence': ['timeline', 'relationship', 'associate', 'chronology'],
};

function categoryScore(
  candidate: PantheonDiscoveryEvidence,
  category: PantheonSearchFirstCategory,
): number {
  const haystack = `${candidate.title || ''} ${candidate.snippet || ''} ${candidate.url}`.toLowerCase();
  const categoryTokens = [...new Set([
    ...tokens(`${category.label} ${category.registry.join(' ')}`),
    ...tokens((CATEGORY_DISCOVERY_HINTS[category.label] || []).join(' ')),
  ])];
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
      byUrl.set(candidate.url, { ...candidate, discoveryLanes: [candidate.lane] });
      continue;
    }
    existing.categoryIndexes = [...new Set([...existing.categoryIndexes, ...candidate.categoryIndexes])];
    existing.discoveryLanes = [...new Set([...(existing.discoveryLanes || [existing.lane]), candidate.lane])];
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
