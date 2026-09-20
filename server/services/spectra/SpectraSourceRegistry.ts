import {
  PANTHEON_VERIFIED_SOURCE_INVENTORY,
  type PantheonBackgroundCategory,
  type PantheonSourceTarget,
} from '../pantheon/PantheonSovereignSourceRegistry';

export type SpectraSourcePriority = 'critical' | 'high' | 'supporting';
export interface SpectraSourceTarget extends PantheonSourceTarget {
  sourceId: string;
  sourceName: string;
  priority: SpectraSourcePriority;
  reason: string;
}

const DIRECT = new Set<string>([
  'identity','identity-resolution','residence','contacts','relatives','associates',
  'geography','chronology','corroboration','contradictions','historical','provenance',
]);
const CONTEXT = new Set<string>([
  'social','usernames','internet','news','employment','education','credentials','business',
  'corporate','property','transportation','courts','family-probate','vital-records',
  'government-employment','military','campaign-finance','professional-discipline','regulatory',
  'organizations','nonprofits','publications','professional-web','domain-web','adverse-media',
  'relationship-graph','false-positive',
]);
const SPECIALIZED = new Set<string>([
  'criminal','arrests','corrections','probation-parole','warrants','sex-offender',
  'financial-public','banking-affiliations','securities','bankruptcy','civil-litigation',
  'estate','tax-public','government-contracting','lobbying','sanctions','foreign-connections',
  'foreign-residence','immigration','intellectual-property','breach-notices','confidence',
  'completeness','crawler-audit','source-audit','final-dossier',
]);

function rank(categories: readonly string[]): SpectraSourcePriority {
  // Specialized/sensitive registries are never promoted merely because they
  // also carry generic identity/residence tags.
  if (categories.some(category => SPECIALIZED.has(category))) return 'supporting';
  if (categories.some(category => DIRECT.has(category))) return 'critical';
  if (categories.some(category => CONTEXT.has(category))) return 'high';
  return 'supporting';
}
function authorityScore(authority: string) {
  return authority === 'primary' ? 4 : authority === 'archive' ? 3 : authority === 'secondary' ? 2 : 1;
}

export const SPECTRA_SOURCE_CATALOG = PANTHEON_VERIFIED_SOURCE_INVENTORY
  .map(source => ({ ...source, priority: rank(source.categories) }));
export const SPECTRA_SOURCE_CATALOG_BY_ID = new Map(
  SPECTRA_SOURCE_CATALOG.map(source => [source.id, source] as const)
);

export function getSpectraSources(
  categories: readonly PantheonBackgroundCategory[] = [],
  jurisdiction?: string,
) {
  const wanted = new Set<string>(categories);
  return SPECTRA_SOURCE_CATALOG
    .filter(source => !wanted.size || source.categories.some(category => wanted.has(category)))
    .filter(source => !jurisdiction || source.jurisdiction === jurisdiction || source.jurisdiction === 'US' || source.jurisdiction === 'US/global')
    .sort((a, b) => {
      const priority = { critical: 3, high: 2, supporting: 1 };
      return priority[b.priority] - priority[a.priority]
        || authorityScore(b.authority) - authorityScore(a.authority)
        || a.id.localeCompare(b.id);
    });
}

function safeText(value: string): string {
  // Replace isolated UTF-16 surrogates before URL/query construction.
  return value.replace(/[\uD800-\uDFFF]/g, '\uFFFD').replace(/\s+/g, ' ').trim();
}

export function buildSpectraPriorityTargets(
  subject: string,
  clues?: string,
  limit = SPECTRA_SOURCE_CATALOG.length,
): SpectraSourceTarget[] {
  const identity = [safeText(subject), safeText(String(clues || ''))]
    .filter(Boolean)
    .map(value => `"${value}"`)
    .join(' ');
  if (!identity) return [];

  const seen = new Set<string>();
  const targets: SpectraSourceTarget[] = [];
  for (const source of getSpectraSources()) {
    const key = source.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const category = (source.categories.find(category => DIRECT.has(category) || CONTEXT.has(category) || SPECIALIZED.has(category))
      || source.categories[0]
      || 'identity') as PantheonBackgroundCategory;
    let host = '';
    try { host = new URL(source.url).hostname; } catch { host = ''; }
    const sourceScopedQuery = [
      host ? `site:${host}` : '',
      identity,
      source.name,
      category,
    ].filter(Boolean).join(' ');

    targets.push({
      sourceId: source.id,
      sourceName: source.name,
      category,
      url: source.url,
      authority: source.authority,
      jurisdiction: source.jurisdiction,
      query: sourceScopedQuery,
      priority: source.priority,
      reason: source.priority === 'critical'
        ? 'direct identity/location/corroboration evidence'
        : source.priority === 'high'
          ? 'records, social, web, or contextual pivot'
          : 'specialized or supporting corroboration source',
    });
    if (targets.length >= Math.max(1, limit)) break;
  }
  return targets;
}

function diversify(targets: SpectraSourceTarget[]): SpectraSourceTarget[] {
  const buckets = new Map<string, SpectraSourceTarget[]>();
  for (const target of targets) {
    const bucket = buckets.get(target.category) || [];
    bucket.push(target);
    buckets.set(target.category, bucket);
  }
  const result: SpectraSourceTarget[] = [];
  while ([...buckets.values()].some(bucket => bucket.length > 0)) {
    for (const bucket of buckets.values()) {
      const next = bucket.shift();
      if (next) result.push(next);
    }
  }
  return result;
}

export function buildSpectraDiscoveryWaves(subject: string, clues?: string) {
  const targets = buildSpectraPriorityTargets(subject, clues);
  return (['critical','high','supporting'] as SpectraSourcePriority[])
    .map(priority => ({
      priority,
      targets: diversify(targets.filter(target => target.priority === priority)),
    }))
    .filter(wave => wave.targets.length > 0);
}
