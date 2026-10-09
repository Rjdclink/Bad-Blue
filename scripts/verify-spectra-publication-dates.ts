import assert from 'node:assert/strict';
import { htmlEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const url = 'https://fictional.example.net/profiles/sample';
const historicalPage = `<!doctype html><html><head>
  <title>Fictional archived profile</title>
  <meta property="article:published_time" content="2016-02-20T18:00:00Z">
  <meta property="og:updated_time" content="2026-10-09T10:00:00Z">
</head><body><p>This page describes an old geographic association.</p></body></html>`;
const historical = htmlEvidence(historicalPage, url);
assert.equal(historical.publishedAt, '2016-02-20T18:00:00.000Z',
  'a recent page update cannot turn an old publication into fresh evidence');
assert.ok(historical.textExcerpt?.includes('old geographic association'));

const freshPage = `<html><head>
  <meta itemprop="datePublished" content="2026-09-11">
</head><body><p>Fictional recent profile.</p></body></html>`;
assert.equal(htmlEvidence(freshPage, url).publishedAt, '2026-09-11T00:00:00.000Z');

const undatedPage = `<html><head>
  <meta property="og:updated_time" content="2026-10-09">
</head><body>Fictional undated profile</body></html>`;
assert.equal(htmlEvidence(undatedPage, url).publishedAt, undefined,
  'fetch/update time must not be misreported as publication time');

const invalidDate = `<html><head>
  <meta property="article:published_time" content="not-a-date">
</head><body>Fictional corrupted metadata</body></html>`;
assert.equal(htmlEvidence(invalidDate, url).publishedAt, undefined);

console.log('SPECTRA public webpage publication-date extraction tests passed.');
