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
  'social','usernames','internet','news','employment','education','business','corporate',
  'property','transportation','courts','criminal','arrests','corrections','probation-parole',
  'warrants','professional-web','domain-web','relationship-graph','false-positive',
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

export function buildSpectraPriorityTargets(
  subject: string,
  clues?: string,
  limit = 220,
): SpectraSourceTarget[] {
  const buckets: SpectraSourceTarget[] = [];

  for (const category of [...CRITICAL, ...HIGH]) {
    const priority = rank(category);
    const perCategory = priority === 'critical' ? 18 : 8;
    for (const target of buildPantheonCategoryTargets(category, subject, clues, perCategory)) {
      buckets.push({
        ...target,
        priority,
        reason: priority === 'critical'
          ? 'direct identity/location/corroboration evidence'
          : 'recursive identity and contextual pivot',
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
