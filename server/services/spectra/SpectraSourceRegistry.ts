import {
  PANTHEON_BACKGROUND_CATEGORIES,
  PANTHEON_VERIFIED_SOURCES,
  type PantheonBackgroundCategory,
  type PantheonSourceTarget,
} from '../pantheon/PantheonSovereignSourceRegistry';

export type SpectraSourcePriority = 'critical' | 'high' | 'supporting';

export interface SpectraCatalogSource {
  id: string;
  name: string;
  url: string;
  jurisdiction: string;
  categories: readonly string[];
  authority: 'primary' | 'secondary' | 'discovery' | 'archive';
  priority: SpectraSourcePriority;
}

const CRITICAL = new Set<string>([
  'identity','identity-resolution','residence','contacts','relatives','associates',
  'geography','chronology','corroboration','contradictions','historical','provenance',
]);
const HIGH = new Set<string>([
  'social','usernames','internet','news','employment','education','credentials','business',
  'corporate','property','transportation','civil-litigation','criminal','arrests','corrections',
  'probation-parole','warrants','courts','family-probate','vital-records','government-employment',
  'military','campaign-finance','professional-discipline','regulatory','organizations','nonprofits',
  'publications','professional-web','domain-web','adverse-media','relationship-graph','false-positive',
]);

function priorityFor(categories: readonly string[]): SpectraSourcePriority {
  if (categories.some(category => CRITICAL.has(category))) return 'critical';
  if (categories.some(category => HIGH.has(category))) return 'high';
  return 'supporting';
}
function authorityScore(authority: SpectraCatalogSource['authority']): number {
  return authority === 'primary' ? 4 : authority === 'archive' ? 3 : authority === 'secondary' ? 2 : 1;
}

/** Every verified source already maintained by the platform, deduplicated and priority ordered for SPECTRA. */
export const SPECTRA_SOURCE_CATALOG: SpectraCatalogSource[] = (() => {
  const seen = new Set<string>();
  return PANTHEON_VERIFIED_SOURCES
    .map(source => ({ ...source, priority: priorityFor(source.categories) }))
    .sort((a, b) => {
      const p = { critical: 3, high: 2, supporting: 1 };
      return p[b.priority] - p[a.priority] || authorityScore(b.authority) - authorityScore(a.authority);
    })
    .filter(source => {
      const key = source.url.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
})();

function clueTerms(subject: string, clues?: string): string {
  return [subject.trim(), String(clues || '').trim()].filter(Boolean).map(value => `"${value}"`).join(' ');
}

/**
 * Build the complete target-specific plan from the saved catalog. Nothing is
 * discarded: ranking controls when a source is used, not whether it exists.
 */
export function buildSpectraPriorityTargets(subject: string, clues?: string): SpectraSourceTarget[] {
  const identity = clueTerms(subject, clues);
  if (!identity) return [];
  return SPECTRA_SOURCE_CATALOG.map(source => {
    const category = (source.categories.find(category =>
      (PANTHEON_BACKGROUND_CATEGORIES as readonly string[]).includes(category)
    ) || 'corroboration') as PantheonBackgroundCategory;
    return {
      category,
      url: source.url,
      authority: source.authority,
      jurisdiction: source.jurisdiction,
      query: `${identity} ${category}`,
      priority: source.priority,
      reason: source.priority === 'critical'
        ? 'direct identity/location/corroboration evidence'
        : source.priority === 'high'
          ? 'identity, records, social, web, or contextual pivot'
          : 'supporting corroboration and completeness source',
    };
  });
}

export interface SpectraSourceTarget extends PantheonSourceTarget {
  priority: SpectraSourcePriority;
  reason: string;
}

export function buildSpectraDiscoveryWaves(subject: string, clues?: string) {
  const targets = buildSpectraPriorityTargets(subject, clues);
  return (['critical','high','supporting'] as const).map(priority => ({
    priority,
    targets: targets.filter(target => target.priority === priority),
  })).filter(wave => wave.targets.length > 0);
}

export function getSpectraSourceCatalogStats() {
  return {
    total: SPECTRA_SOURCE_CATALOG.length,
    critical: SPECTRA_SOURCE_CATALOG.filter(source => source.priority === 'critical').length,
    high: SPECTRA_SOURCE_CATALOG.filter(source => source.priority === 'high').length,
    supporting: SPECTRA_SOURCE_CATALOG.filter(source => source.priority === 'supporting').length,
  };
}
