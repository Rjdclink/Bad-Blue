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

const malformedPriorityTag = `<html><head>
  <meta property="article:published_time" content="invalid">
  <meta itemprop="datePublished" content="2026-09-03">
</head><body>Fictional dated record.</body></html>`;
assert.equal(htmlEvidence(malformedPriorityTag, url).publishedAt, '2026-09-03T00:00:00.000Z',
  'an invalid publication tag must not suppress the valid alternate date');

const datedJsonLd = `<html><head>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfilePage","datePublished":"2015-07-12T10:00:00Z"}</script>
</head><body>A dated fictional profile.</body></html>`;
assert.equal(htmlEvidence(datedJsonLd, url).publishedAt, '2015-07-12T10:00:00.000Z',
  'old JSON-LD ProfilePage publication dates cannot be treated as fresh');

const graphJsonLd = `<html><head>
  <script type="application/ld+json">{"@graph":[{"@type":"Person","birthDate":"1980-03-20"},{"@type":"NewsArticle","datePublished":"2026-08-02"}]}</script>
</head><body>Fictional news excerpt.</body></html>`;
assert.equal(htmlEvidence(graphJsonLd, url).publishedAt, '2026-08-02T00:00:00.000Z',
  'top-level article node of JSON-LD @graph should supply the page date');

const unrelatedJsonLd = `<html><head>
  <script type="application/ld+json">{"@type":"Person","birthDate":"1980-03-20","datePublished":"2018-03-20"}</script>
</head><body>Fictional person detail.</body></html>`;
assert.equal(htmlEvidence(unrelatedJsonLd, url).publishedAt, undefined,
  'person attributes are not proof of a webpage publication date');

console.log('SPECTRA public webpage publication-date extraction tests passed.');
