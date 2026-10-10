/**
 * Reproducible, strictly public institutional city-field benchmark.
 *
 * --fixtures: deterministic offline regressions used by npm run verify:spectra
 * --live: one-time network test using SPECTRA's actual public-page retrieval.
 * No scheduled task, account access, phone number, or individual location.
 */
import assert from 'node:assert/strict';
import {
  INSTITUTION_FIELD_CASES,
  evaluateInstitutionFieldCase,
  evaluateInstitutionFieldSource,
  type InstitutionFieldCase,
} from '../server/services/spectra/SpectraInstitutionCityBenchmark';
import {
  retrieveSpectraPublicEvidence,
  type SpectraRetrievedEvidence,
} from '../server/services/spectra/SpectraPublicRetrieval';
import { unboundPublicGeoContext } from '../server/services/spectra/SpectraPublicEvidenceProvenance';

function syntheticEvidence(
  requestedUrl: string,
  textExcerpt: string,
  overrides: Partial<SpectraRetrievedEvidence> = {},
): SpectraRetrievedEvidence {
  return {
    url: requestedUrl,
    requestedUrl,
    retrievedAt: '2026-10-10T12:00:00.000Z',
    textExcerpt,
    observations: [],
    ...overrides,
  };
}

function addressFor(field: InstitutionFieldCase, city = field.expectedCity, state = field.expectedState): string {
  const suffix = field.id === 'boston-central-library' ? 'Street'
    : field.id === 'wisconsin-historical-society' ? 'St.'
    : 'Ave.';
  return field.streetClues[0] + ' ' + suffix + ', ' + city + ', ' + state + ' 02116';
}

function verifyFixtures(): void {
  for (const field of INSTITUTION_FIELD_CASES) {
    const text = field.nameClues[0] + ' — ' + addressFor(field);
    const both = field.sourceUrls.map(url => syntheticEvidence(url, text));
    const positive = evaluateInstitutionFieldCase(field, both);
    assert.equal(positive.outcome, 'correct', field.id + ': two publishers must establish venue city');
    assert.equal(positive.sources.length, 2);
    assert.ok(positive.sources.every(source => source.publicationStatus === 'undated'),
      field.id + ': retrieval time is not a publication date');

    assert.equal(evaluateInstitutionFieldCase(field, both.slice(0, 1)).outcome, 'abstained',
      'one publisher alone must not establish a supported venue city');

    const unrelated = syntheticEvidence(
      field.sourceUrls[1],
      field.nameClues[0] + ' mentions the city ' + field.expectedCity + ' without any street address.',
    );
    assert.equal(evaluateInstitutionFieldCase(field, [both[0], unrelated]).outcome, 'abstained',
      'a city elsewhere on a page must not substitute for its venue address');

    const contradiction = syntheticEvidence(
      field.sourceUrls[1],
      field.nameClues[0] + ' — ' + addressFor(field, 'Unrelatedtown', 'NY'),
    );
    assert.equal(evaluateInstitutionFieldCase(field, [both[0], contradiction]).outcome, 'abstained',
      'contradictory institutional city addresses require abstention');

    const sameWrong = field.sourceUrls.map(url =>
      syntheticEvidence(url, field.nameClues[0] + ' — ' + addressFor(field, 'Unrelatedtown', 'NY')));
    assert.equal(evaluateInstitutionFieldCase(field, sameWrong).outcome, 'wrong_city',
      'a source-backed but incorrect venue city must count as an error');

    const undated = evaluateInstitutionFieldSource(field, field.sourceUrls[0],
      syntheticEvidence(field.sourceUrls[0], text, {
        retrievedAt: '2030-01-01T00:00:00Z',
      }));
    assert.equal(undated.publicationStatus, 'undated');
    assert.equal(undated.publishedAt, undefined);
  }

  const first = INSTITUTION_FIELD_CASES[0];
  const copied = first.nameClues[0] + ' — ' + addressFor(first);
  const redirected = first.sourceUrls.map(url =>
    syntheticEvidence(url, copied, { url: 'https://same-publisher.example.org/canonical' }));
  assert.equal(evaluateInstitutionFieldCase(first, redirected).outcome, 'abstained',
    'two links redirected to one publisher do not count as independent evidence');

  const geotag = unboundPublicGeoContext([{
    latitude: 42.3491,
    longitude: -71.0783,
    sourceUrl: first.sourceUrls[0],
    acquisitionMethod: 'json-ld-geospatial-metadata',
  }])[0];
  assert.equal(geotag.kind, 'public_source_geospatial_context');
  assert.equal(geotag.subjectMatchConfidence, 0);
  assert.equal(geotag.currentPositionVerified, false);

  console.log('SPECTRA public institution field fixtures passed: three venues, address/date provenance, publisher independence, contradiction, abstention, wrong-city and unbound geotag.');
}

async function verifyLive(): Promise<void> {
  const urls = INSTITUTION_FIELD_CASES.flatMap(field => [...field.sourceUrls]);
  assert.equal(urls.length, 6);
  // Uses the same bounded HTTP(S) SPECTRA production retrieval function.
  // An unavailable page is a recorded failure/abstention, never a claim.
  const retrieved = await retrieveSpectraPublicEvidence(urls);
  const cases = INSTITUTION_FIELD_CASES.map(field => evaluateInstitutionFieldCase(field, retrieved));
  const summary = {
    mode: 'live-public-venue-field',
    retrievalDate: new Date().toISOString(),
    requestedPages: urls.length,
    retrievedPages: retrieved.length,
    cases: cases.length,
    correct: cases.filter(item => item.outcome === 'correct').length,
    wrongCity: cases.filter(item => item.outcome === 'wrong_city').length,
    abstained: cases.filter(item => item.outcome === 'abstained').length,
    verdict: 'inconclusive' as 'passed' | 'failed' | 'inconclusive',
    results: cases,
  };
  summary.verdict = summary.wrongCity > 0 ? 'failed'
    : summary.correct === 0 ? 'inconclusive' : 'passed';
  console.log(JSON.stringify(summary, null, 2));
  if (summary.wrongCity > 0) process.exitCode = 1;
  else if (summary.correct === 0) process.exitCode = 2;
}

const mode = process.argv[2];
if (mode === '--fixtures') verifyFixtures();
else if (mode === '--live') await verifyLive();
else {
  console.error('Usage: node --import tsx scripts/verify-spectra-public-city-field.ts --fixtures|--live');
  process.exitCode = 64;
}
