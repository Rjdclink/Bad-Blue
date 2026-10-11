import assert from 'node:assert/strict';
import { collectSpectraPublicAccountRecords } from '../server/services/spectra/SpectraPublicAccountRecords';
import { collectSpectraPublicNewsRecords } from '../server/services/spectra/SpectraPublicNewsRecords';
import { collectSpectraPublicMastodonRecords } from '../server/services/spectra/SpectraPublicMastodonRecords';
import { collectSpectraPublicWikimediaRecords } from '../server/services/spectra/SpectraPublicWikimediaRecords';
import { inferProvisionalRegionalCities } from '../server/services/spectra/SpectraRegionalInference';
import { mergePublicRetrievedMetadata } from '../server/services/spectra/SpectraPublicEvidenceProvenance';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const did = `did:plc:${'a'.repeat(24)}`;
const now = new Date().toISOString();
const calls: string[] = [];
const fetchImpl: typeof fetch = async (request) => {
  const url = String(request);
  calls.push(url);
  const payload = url.includes('getProfile')
    ? { did, handle: 'sample.bsky.social' }
    : { feed: [
        { post: { uri: `at://${did}/app.bsky.feed.post/abc`, author: { did, handle: 'sample.bsky.social' },
          record: { $type: 'app.bsky.feed.post', createdAt: now, text: 'Public statement' } } },
        { post: { uri: `at://${did}/app.bsky.feed.post/def`, author: { did: `did:plc:${'b'.repeat(24)}` },
          record: { $type: 'app.bsky.feed.post', createdAt: now, text: 'Unrelated repost' } } },
      ] };
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
};
assert.equal((await collectSpectraPublicAccountRecords('Jane Doe', { fetchImpl })).status, 'not_supplied');
assert.equal(calls.length, 0, 'unprovided profiles must not trigger broad account queries');
const account = await collectSpectraPublicAccountRecords('https://bsky.app/profile/sample.bsky.social', { fetchImpl });
assert.equal(account.status, 'ok');
assert.equal(account.records.length, 2);
assert.equal(account.records[0].title, 'Public Bluesky profile');
assert.equal((account.records[1].structuredRecord as any).record.text, 'Public statement');
assert.equal(account.records[0].observations.length, 0);
assert(calls.every(url => new URL(url).host === 'public.api.bsky.app'));
const profileOnly = await collectSpectraPublicAccountRecords('https://bsky.app/profile/sample.bsky.social', {
  fetchImpl: async (request) => String(request).includes('getProfile')
    ? new Response(JSON.stringify({ did, handle: 'sample.bsky.social' }), { headers: { 'content-type': 'application/json' } })
    : new Response('unavailable', { status: 503 }),
});
assert.equal(profileOnly.status, 'partial');
assert.equal(profileOnly.records.length, 1, 'a successful public profile survives a feed failure');
const wrongHandle = await collectSpectraPublicAccountRecords('https://bsky.app/profile/sample.bsky.social', {
  fetchImpl: async () => new Response(JSON.stringify({ did, handle: 'someone-else.bsky.social' }),
    { headers: { 'content-type': 'application/json' } }),
});
assert.equal(wrongHandle.status, 'failed', 'a mismatched handle must not attach another account');

const mastodonCalls: Array<{ url: string; authorization?: string }> = [];
const mastodonFetch: typeof fetch = async (request, init) => {
  const url = String(request);
  mastodonCalls.push({ url, authorization: new Headers(init?.headers).get('authorization') || undefined });
  const payload = url.includes('/accounts/lookup')
    ? { id: '42', url: 'https://social.example/@sample' }
    : [
        { account: { id: '42' }, visibility: 'public', created_at: now,
          content: '<p>Public statement</p>', url: 'https://social.example/@sample/123' },
        { account: { id: '42' }, visibility: 'private', created_at: now,
          content: '<p>Private</p>', url: 'https://social.example/@sample/124' },
        { account: { id: '43' }, visibility: 'public', created_at: now,
          content: '<p>Other author</p>', url: 'https://social.example/@other/125' },
      ];
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
};
const validateOrigin = async (value: string) => new URL(value);
assert.equal((await collectSpectraPublicMastodonRecords('Jane Doe', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', fetchImpl: mastodonFetch, validateOrigin,
})).status, 'not_supplied');
assert.equal(mastodonCalls.length, 0);
const mastodon = await collectSpectraPublicMastodonRecords('https://social.example/@sample', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', fetchImpl: mastodonFetch, validateOrigin,
});
assert.equal(mastodon.status, 'ok');
assert.equal(mastodon.records.length, 2);
assert.equal(mastodon.records[0].title, 'Public Mastodon profile');
assert.equal(mastodon.records[1].textExcerpt, 'Public statement');
assert.equal(mastodon.records[1].observations.length, 0);
assert(mastodonCalls.every(call => new URL(call.url).host === 'mastodon.social'));
assert.equal(mastodonCalls[0].authorization, 'Bearer test-token');
assert.equal(mastodonCalls[1].authorization, undefined, 'the token is only used for account lookup');
const mastodonProfileOnly = await collectSpectraPublicMastodonRecords('https://social.example/@sample', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', validateOrigin,
  fetchImpl: async (request) => String(request).includes('/accounts/lookup')
    ? new Response(JSON.stringify({ id: '42', url: 'https://social.example/@sample' }), { headers: { 'content-type': 'application/json' } })
    : new Response('unavailable', { status: 503 }),
});
assert.equal(mastodonProfileOnly.status, 'partial');
assert.equal(mastodonProfileOnly.records.length, 1, 'a successful public profile survives a status failure');
const rejectedToken = await collectSpectraPublicMastodonRecords('https://social.example/@sample', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', validateOrigin,
  fetchImpl: async () => new Response('unauthorized', { status: 401 }),
});
assert.equal(rejectedToken.status, 'failed');
assert.equal(rejectedToken.reason, 'authorization_failed', 'a rejected token needs an actionable, sanitized diagnostic');
const mismatch = await collectSpectraPublicMastodonRecords('https://other.example/@sample', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', fetchImpl: mastodonFetch, validateOrigin,
});
assert.equal(mismatch.status, 'failed', 'an unrelated account URL must not be attached to a supplied profile');

let commonsCalls = 0;
const commonsRetrieve = async (urls: string[]): Promise<SpectraRetrievedEvidence[]> => {
  commonsCalls += 1;
  assert.equal(new URL(urls[0]).hostname, 'commons.wikimedia.org');
  assert.equal(new URL(urls[0]).searchParams.get('titles'), 'File:Example.jpg');
  return [{ url: urls[0], requestedUrl: urls[0], retrievedAt: now, observations: [],
    structuredRecord: { query: { pages: { '123': { pageid: 123, title: 'File:Example.jpg',
      imageinfo: [{ timestamp: now, user: 'ExampleUploader', metadata: [{ name: 'GPSLatitude', value: '10' }] }] } } } } }];
};
assert.equal((await collectSpectraPublicWikimediaRecords('Jane Doe', { retrieve: commonsRetrieve })).status, 'not_supplied');
assert.equal(commonsCalls, 0);
const commons = await collectSpectraPublicWikimediaRecords('https://commons.wikimedia.org/wiki/File:Example.jpg',
  { retrieve: commonsRetrieve });
assert.equal(commons.status, 'ok');
assert.equal(commons.records.length, 1);
assert.equal(commons.records[0].observations.length, 0, 'a file geotag is not a subject position');
assert.equal((commons.records[0].structuredRecord as any).imageinfo.user, 'ExampleUploader');

const article: SpectraRetrievedEvidence = {
  url: 'https://publisher.example/article', requestedUrl: 'https://publisher.example/article',
  retrievedAt: now, publishedAt: now, textExcerpt: 'Jane Doe lives in Salem, Oregon.', observations: [],
};
const index: SpectraRetrievedEvidence = {
  url: 'https://api.gdeltproject.org/api/v2/doc/doc', requestedUrl: 'https://api.gdeltproject.org/api/v2/doc/doc',
  retrievedAt: now, structuredRecord: { articles: [{ url: article.url }] }, observations: [],
};
const retrieve = async (urls: string[]): Promise<SpectraRetrievedEvidence[]> =>
  urls[0].includes('gdeltproject') ? [index] : [article];
const news = await collectSpectraPublicNewsRecords('Jane Doe', { retrieve });
assert.equal(news.status, 'ok');
assert.deepEqual(news.records, [article], 'the index lead must not be reported as a retrieved article');
const empty = await collectSpectraPublicNewsRecords('Jane Doe', {
  retrieve: async (urls) => urls[0].includes('gdeltproject') ? [index] : [],
});
assert.equal(empty.status, 'failed');
assert.equal(empty.records.length, 0);

const source = {
  url: article.url, title: 'News', snippet: 'Search result',
  metadata: mergePublicRetrievedMetadata({}, article),
};
assert.deepEqual(inferProvisionalRegionalCities('Jane Doe', [source]).map(city => [city.city, city.state]), [['Salem', 'OR']]);
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...source, metadata: {} }]).length, 0,
  'a search snippet is not a fetched residence claim');
assert.equal(inferProvisionalRegionalCities('Other Person', [source]).length, 0);
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...source,
  metadata: { ...source.metadata, publishedAt: '2010-01-01T00:00:00Z' },
}]).length, 0, 'known stale publications must not support a current hypothesis');
console.log('SPECTRA direct public record and provisional city checks passed');
