import {
  buildPantheonCategoryTargets,
  type PantheonBackgroundCategory,
  type PantheonSourceTarget,
} from '../pantheon/PantheonSovereignSourceRegistry';

export type SpectraSourcePriority = 'critical' | 'high' | 'supporting';

export interface SpectraSourceTarget extends PantheonSourceTarget {
  priority: SpectraSourcePriority;
  reason: string;
}

const CRITICAL: PantheonBackgroundCategory[] = [
  'identity','identity-resolution','residence','contacts','relatives','associates',
  'geography','chronology','corroboration','contradictions','historical','provenance',
];

const HIGH: PantheonBackgroundCategory[] = [
  'social','usernames','internet','news','employment','education','credentials','business',
  'corporate','property','transportation','civil-litigation','criminal','arrests','corrections',
  'probation-parole','warrants','courts','family-probate','vital-records','government-employment',
  'military','campaign-finance','professional-discipline','regulatory','organizations','nonprofits',
  'publications','professional-web','domain-web','adverse-media','relationship-graph','false-positive',
];

const SUPPORTING: PantheonBackgroundCategory[] = [
  'financial-public','banking-affiliations','securities','bankruptcy','sex-offender','estate',
  'tax-public','government-contracting','lobbying','sanctions','foreign-connections',
  'foreign-residence','immigration','intellectual-property','breach-notices','confidence',
  'completeness','crawler-audit','source-audit',
];

function rank(category: PantheonBackgroundCategory): SpectraSourcePriority {
  if (CRITICAL.includes(category)) return 'critical';
  if (HIGH.includes(category)) return 'high';
  return 'supporting';
}

function scoreAuthority(authority: PantheonSourceTarget['authority']): number {
  if (authority === 'primary') return 4;
  if (authority === 'archive') return 3;
  if (authority === 'secondary') return 2;
  return 1;
}

/**
 * Persistent SPECTRA source router.
 *
 * The canonical source URLs remain in PantheonSovereignSourceRegistry and its
 * verified batches. SPECTRA compiles those sources into a target-specific,
 * priority-ordered retrieval plan. This keeps the source catalog in one place
 * while making the full relevant inventory immediately reusable by SPECTRA.
 */
export function buildSpectraPriorityTargets(
  subject: string,
  clues?: string,
  limit = 1200,
): SpectraSourceTarget[] {
  const buckets: SpectraSourceTarget[] = [];
  const categories = [...CRITICAL, ...HIGH, ...SUPPORTING];

  for (const category of categories) {
    const priority = rank(category);
    const perCategory = priority === 'critical' ? 36 : priority === 'high' ? 20 : 10;
    for (const target of buildPantheonCategoryTargets(category, subject, clues, perCategory)) {
      buckets.push({
        ...target,
        priority,
        reason: priority === 'critical'
          ? 'direct identity/location/corroboration evidence'
          : priority === 'high'
            ? 'recursive identity, records, social, web, or contextual pivot'
            : 'supporting corroboration and completeness source',
      });
    }
  }

  const seen = new Set<string>();
  return buckets
    .sort((a, b) => {
      const priorityScore = { critical: 3, high: 2, supporting: 1 };
      return priorityScore[b.priority] - priorityScore[a.priority]
        || scoreAuthority(b.authority) - scoreAuthority(a.authority);
    })
    .filter(target => {
      const key = target.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function buildSpectraDiscoveryWaves(
  subject: string,
  clues?: string,
): { priority: SpectraSourcePriority; queries: string[] }[] {
  const targets = buildSpectraPriorityTargets(subject, clues);
  return (['critical','high','supporting'] as SpectraSourcePriority[]).map(priority => ({
    priority,
    queries: [...new Set(
      targets.filter(target => target.priority === priority).map(target => target.query)
    )],
  })).filter(wave => wave.queries.length > 0);
}
