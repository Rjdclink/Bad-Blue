import assert from 'node:assert/strict';
import { evaluateSpectraRegionalBenchmark, type SpectraRegionalBenchmarkCase } from '../server/services/spectra/SpectraRegionalBenchmark';

const asOf = new Date('2026-10-11T12:00:00Z');
const source = (url: string, text: string, publishedAt = '2026-09-10T12:00:00Z') => ({
  url, metadata: { sourceUrl: url, requestedUrl: url, fetchedExcerpt: text, publishedAt },
});
const cases: SpectraRegionalBenchmarkCase[] = [
  { id: 'single', subject: 'Jane Example', category: 'sparse', expected: { city: 'Salem', state: 'OR' },
    sources: [source('https://publisher.example/article', 'Jane Example lives in Salem, Oregon.')] },
  { id: 'wrong', subject: 'Jane Example', category: 'conflicting', expected: { city: 'Salem', state: 'OR' },
    sources: [source('https://a.example/one', 'Jane Example lives in Boise, Idaho.'),
      source('https://b.example/two', 'Jane Example lives in Salem, Oregon.')] },
  { id: 'old', subject: 'Jane Example', category: 'stale', expected: { city: 'Salem', state: 'OR' },
    sources: [source('https://old.example/story', 'Jane Example lives in Salem, Oregon.', '2010-01-01T00:00:00Z')] },
  { id: 'other-person', subject: 'Jane Example', category: 'common_name', expected: null,
    sources: [source('https://name.example/story', 'Other Person lives in Salem, Oregon.')] },
  { id: 'false-positive', subject: 'Jane Example', category: 'other', expected: null,
    sources: [source('https://mistaken.example/story', 'Jane Example lives in Salem, Oregon.')] },
];
const result = evaluateSpectraRegionalBenchmark(cases, asOf);
assert.equal(result.cases, 5);
assert.equal(result.knownRegionCases, 3);
assert.equal(result.top1Correct, 1);
assert.equal(result.top3Correct, 2);
assert.equal(result.coverage, 2);
assert.equal(result.abstainedKnown, 1);
assert.equal(result.wrongTop1, 1);
assert.equal(result.correctlyAbstainedNegative, 1);
assert.equal(result.falsePositiveNegative, 1);
assert.equal(result.top1AccuracyWhenAnswered, 0.5);
assert.equal(result.top1AccuracyAcrossKnown, 1 / 3);
assert(!JSON.stringify(result).includes('Jane Example'), 'aggregate output must not include names');
assert.throws(() => evaluateSpectraRegionalBenchmark([...cases, cases[0]], asOf), /Invalid or duplicate/);
console.log('SPECTRA regional benchmark aggregate and negative-control checks passed (synthetic data only).');
