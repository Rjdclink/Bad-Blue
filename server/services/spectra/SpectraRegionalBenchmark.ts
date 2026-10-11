import { inferProvisionalRegionalCities, type RegionalSourceExcerpt } from './SpectraRegionalInference';

export interface SpectraRegionalBenchmarkCase {
  /** A stable test identifier, never included in the aggregate result. */
  id: string;
  subject: string;
  sources: RegionalSourceExcerpt[];
  /** Null means the sources justify no city claim, not an unknown real-world answer. */
  expected: { city: string; state: string } | null;
  category: 'common_name' | 'sparse' | 'stale' | 'conflicting' | 'duplicate' | 'other';
}

export interface SpectraRegionalBenchmarkSummary {
  cases: number;
  knownRegionCases: number;
  noJustifiedRegionCases: number;
  top1Correct: number;
  top3Correct: number;
  coverage: number;
  abstainedKnown: number;
  wrongTop1: number;
  correctlyAbstainedNegative: number;
  falsePositiveNegative: number;
  byCategory: Record<string, { cases: number; top1Correct: number; abstained: number; falsePositiveNegative: number }>;
  top1AccuracyWhenAnswered: number | null;
  top1AccuracyAcrossKnown: number | null;
}

const key = (value: { city: string; state: string }) =>
  `${value.city.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()}|${value.state.toUpperCase().trim()}`;

/** Aggregate only. The subject, source excerpts, and individual truth stay in the test input. */
export function evaluateSpectraRegionalBenchmark(
  cases: readonly SpectraRegionalBenchmarkCase[], asOf: Date = new Date(),
): SpectraRegionalBenchmarkSummary {
  if (!cases.length || cases.length > 1_000 || !Number.isFinite(asOf.getTime())) {
    throw new RangeError('A bounded, dated evaluation set is required.');
  }
  const summary: SpectraRegionalBenchmarkSummary = {
    cases: cases.length, knownRegionCases: 0, noJustifiedRegionCases: 0,
    top1Correct: 0, top3Correct: 0, coverage: 0, abstainedKnown: 0,
    wrongTop1: 0, correctlyAbstainedNegative: 0, falsePositiveNegative: 0,
    byCategory: {}, top1AccuracyWhenAnswered: null, top1AccuracyAcrossKnown: null,
  };
  const seen = new Set<string>();
  for (const item of cases) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)
      || typeof item.subject !== 'string' || !Array.isArray(item.sources)
      || item.sources.length > 200 || !['common_name', 'sparse', 'stale', 'conflicting', 'duplicate', 'other'].includes(item.category)
      || (item.expected !== null && (!item.expected || typeof item.expected.city !== 'string'
        || typeof item.expected.state !== 'string' || !item.expected.city.trim() || !item.expected.state.trim()))) {
      throw new TypeError('Invalid or duplicate regional benchmark case.');
    }
    seen.add(item.id);
    const category = summary.byCategory[item.category] ||= {
      cases: 0, top1Correct: 0, abstained: 0, falsePositiveNegative: 0,
    };
    category.cases++;
    const candidates = inferProvisionalRegionalCities(item.subject, item.sources, asOf);
    if (item.expected === null) {
      summary.noJustifiedRegionCases++;
      if (candidates.length) { summary.falsePositiveNegative++; category.falsePositiveNegative++; }
      else { summary.correctlyAbstainedNegative++; category.abstained++; }
      continue;
    }
    summary.knownRegionCases++;
    if (!candidates.length) { summary.abstainedKnown++; category.abstained++; continue; }
    summary.coverage++;
    const expected = key(item.expected);
    if (key(candidates[0]) === expected) { summary.top1Correct++; category.top1Correct++; }
    else summary.wrongTop1++;
    if (candidates.some(candidate => key(candidate) === expected)) summary.top3Correct++;
  }
  summary.top1AccuracyWhenAnswered = summary.coverage ? summary.top1Correct / summary.coverage : null;
  summary.top1AccuracyAcrossKnown = summary.knownRegionCases
    ? summary.top1Correct / summary.knownRegionCases : null;
  return summary;
}
