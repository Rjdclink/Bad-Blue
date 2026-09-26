import {
  buildPantheonBackgroundRegistryTargets,
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

export const SPECTRA_SOURCE_CATALOG: Array<never> = [];
export const SPECTRA_SOURCE_CATALOG_BY_ID = new Map();

function safeText(value: string): string {
  // Replace isolated UTF-16 surrogates before URL/query construction.
  return value.replace(/[\uD800-\uDFFF]/g, '\uFFFD').replace(/\s+/g, ' ').trim();
}

export function buildSpectraPriorityTargets(
  subject: string,
  clues?: string,
  limit = 300,
): SpectraSourceTarget[] {
  const identity = [safeText(subject), safeText(String(clues || ''))].filter(Boolean).join(' ');
  if (!identity) return [];
  const seeds = buildPantheonBackgroundRegistryTargets(subject, clues, 10);
  return seeds.slice(0, Math.max(1, limit)).map((source, index) => {
    const priority = rank([source.category]);
    return {
      ...source,
      sourceId: source.sourceIds?.[0] || `dynamic-seed-${index + 1}`,
      sourceName: new URL(source.url).hostname,
      priority,
      reason: priority === 'critical'
        ? 'direct identity/location/corroboration seed'
        : priority === 'high'
          ? 'records, web, or contextual discovery seed'
          : 'specialized or supporting discovery seed',
    };
  });
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
