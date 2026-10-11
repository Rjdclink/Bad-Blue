import assert from 'node:assert/strict';
import { collectSpectraPublicAccountRecords, discoverSpectraPublicBlueskyProfiles } from '../server/services/spectra/SpectraPublicAccountRecords';
import { collectSpectraPublicNewsRecords } from '../server/services/spectra/SpectraPublicNewsRecords';
import { collectSpectraPublicMastodonRecords, discoverSpectraPublicMastodonProfiles } from '../server/services/spectra/SpectraPublicMastodonRecords';
import { collectSpectraPublicWikimediaRecords } from '../server/services/spectra/SpectraPublicWikimediaRecords';
import { inferProvisionalRegionalCities, inferPublicContactProfileCities, retrievedRegionalSources } from '../server/services/spectra/SpectraRegionalInference';
import { mergePublicRetrievedMetadata } from '../server/services/spectra/SpectraPublicEvidenceProvenance';
import { publicProfileContactMatch, publicProfileNameMatch } from '../server/services/spectra/SpectraPublicProfileIdentity';
import { publicProfileLeads } from '../server/services/spectra/SpectraPublicProfileLeads';
import { collectSpectraPublicBlueskyImages } from '../server/services/spectra/SpectraPublicImageRecords';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const did = `did:plc:${'a'.repeat(24)}`;
const now = new Date().toISOString();
assert.equal(publicProfileContactMatch({ textExcerpt: 'Reach Jane at jane@example.org' },
  { email: 'jane@example.org' }), 'email');
assert.equal(publicProfileContactMatch({ textExcerpt: 'Not jane@example.org.evil' },
  { email: 'jane@example.org' }), null);
assert.equal(publicProfileContactMatch({ textExcerpt: 'Call (712) 209-8254' },
  { phone: '712-209-8254' }), 'phone');
assert.equal(publicProfileContactMatch({ textExcerpt: 'No public contact' },
  { email: 'jane@example.org', phone: '712-209-8254' }), null);
assert.equal(publicProfileNameMatch({ structuredRecord: { displayName: 'Jane Doe' } }, 'Jane Maria Doe'), true);
assert.equal(publicProfileNameMatch({ structuredRecord: { display_name: 'Jane Doe' } }, 'Jane Maria Doe'), true);
assert.equal(publicProfileNameMatch({ structuredRecord: { displayName: 'Jane Smith' } }, 'Jane Maria Doe'), false);
assert.equal(publicProfileNameMatch({ structuredRecord: { handle: 'jane.bsky.social' } }, 'Jane Doe'), false);
assert.deepEqual(publicProfileLeads([
  'https://evil.example/?next=https://bsky.app/profile/jane.bsky.social',
  'https://bsky.app/profile/jane.bsky.social/post/abc',
  'https://bsky.app/profile/jane.bsky.social',
  'https://bsky.app/?next=https://bsky.app/profile/wrong.bsky.social',
  'https://bsky.app/profile/another.bsky.social',
], 'bluesky'), [
  'https://bsky.app/profile/jane.bsky.social', 'https://bsky.app/profile/another.bsky.social',
]);
assert.deepEqual(publicProfileLeads([
  'https://social.example/@jane/123',
  'https://social.example/@jane',
  'https://social.example/?next=https://social.example/@wrong',
  'https://social.example/@other',
], 'mastodon', ['https://social.example/@other']), ['https://social.example/@jane']);
const profileCityRecord: SpectraRetrievedEvidence = {
  url: 'https://bsky.app/profile/jane.bsky.social', requestedUrl: 'https://bsky.app/profile/jane.bsky.social',
  retrievedAt: now, title: 'Possible public Bluesky profile',
  textExcerpt: 'Contact jane@example.org. Based in Sioux Falls, SD.',
  structuredRecord: { displayName: 'Jane Doe' }, observations: [],
};
const profileCities = inferPublicContactProfileCities('Jane Maria Doe', [profileCityRecord],
  { email: 'jane@example.org' });
assert.equal(profileCities[0]?.city, 'Sioux Falls');
assert.equal(profileCities[0]?.state, 'SD');
assert.equal(profileCities[0]?.supportingClaims[0]?.identityStatus, 'public_contact_match_unverified');
assert.equal(profileCities[0]?.currentPositionVerified, false);
assert.equal(profileCities[0]?.publishedAt, null);
assert.equal(inferPublicContactProfileCities('Jane Maria Doe', [profileCityRecord],
  { email: 'other@example.org' }).length, 0);
assert.equal(inferPublicContactProfileCities('Other Person', [profileCityRecord],
  { email: 'jane@example.org' }).length, 0);
assert.equal(inferPublicContactProfileCities('Jane Maria Doe', [{ ...profileCityRecord,
  textExcerpt: 'Contact jane@example.org. Previously based in Sioux Falls, SD.',
}], { email: 'jane@example.org' }).length, 0);
const candidateCalls: string[] = [];
const candidates = await discoverSpectraPublicBlueskyProfiles('Jane Maria Doe', {
  fetchImpl: async (request) => {
    const url = String(request);
    candidateCalls.push(url);
    return new Response(JSON.stringify({ actors: [
      { did, handle: 'jane.bsky.social', displayName: 'Jane Doe', description: 'Public biography' },
      { did: `did:plc:${'b'.repeat(24)}`, handle: 'other.bsky.social', displayName: 'Other Doe' },
    ] }), { headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(candidates.status, 'ok');
assert.equal(candidates.records.length, 1);
assert.equal(candidates.records[0].url, 'https://bsky.app/profile/jane.bsky.social');
assert.equal(candidates.records[0].observations.length, 0, 'name matches cannot become location observations');
assert.equal(candidateCalls.length, 1);
assert.equal(new URL(candidateCalls[0]).hostname, 'public.api.bsky.app');
assert.equal(new URL(candidateCalls[0]).searchParams.get('q'), 'jane doe');
assert.equal((await discoverSpectraPublicBlueskyProfiles('Jane', { fetchImpl: async () => {
  throw new Error('one-word names must not be searched');
} })).status, 'skipped');
const calls: string[] = [];
const fetchImpl: typeof fetch = async (request) => {
  const url = String(request);
  calls.push(url);
  const payload = url.includes('getProfile')
    ? { did, handle: 'sample.bsky.social' }
    : { feed: [
        { post: { uri: `at://${did}/app.bsky.feed.post/abc`, author: { did, handle: 'sample.bsky.social' },
          embed: { images: [{ fullsize: 'https://cdn.bsky.app/img/example', alt: 'Public photograph' }] },
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
assert.equal((account.records[1].structuredRecord as any).embed.images[0].alt, 'Public photograph');
assert.equal(account.records[0].observations.length, 0);
assert(calls.every(url => new URL(url).host === 'public.api.bsky.app'));
const imageCalls: string[] = [];
const publicImages = await collectSpectraPublicBlueskyImages([account.records[1]], {
  fetchImpl: async (request, init) => {
    imageCalls.push(String(request));
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      { headers: { 'content-type': 'image/jpeg' } });
  },
});
assert.equal(publicImages.attempted, 1);
assert.equal(publicImages.records.length, 1);
assert.equal(imageCalls[0], 'https://cdn.bsky.app/img/example');
assert.equal(publicImages.records[0].observations.length, 0);
assert.equal((publicImages.records[0].structuredRecord as any).imageBytesArchived, false);
assert.equal((publicImages.records[0].structuredRecord as any).byteLength, 4);
const rejectedImage = await collectSpectraPublicBlueskyImages([account.records[1]], {
  fetchImpl: async () => new Response('oversized', {
    headers: { 'content-type': 'image/jpeg', 'content-length': '3000001' },
  }),
});
assert.equal(rejectedImage.failed, 1);
assert.equal(rejectedImage.records.length, 0);
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
const mastodonCandidates = await discoverSpectraPublicMastodonProfiles('Jane Maria Doe', {
  token: 'test-token', instanceUrl: 'https://mastodon.social', validateOrigin,
  fetchImpl: async (request, init) => {
    assert.equal(new URL(String(request)).pathname, '/api/v1/accounts/search');
    assert.equal(new URL(String(request)).searchParams.get('q'), 'jane doe');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
    return new Response(JSON.stringify([
      { url: 'https://social.example/@jane', display_name: 'Jane Doe', note: '<p>Public biography</p>' },
      { url: 'https://social.example/@other', display_name: 'Other Doe' },
    ]), { headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(mastodonCandidates.status, 'ok');
assert.equal(mastodonCandidates.records.length, 1);
assert.equal(mastodonCandidates.records[0].textExcerpt, 'Public biography');
assert.equal(mastodonCandidates.records[0].observations.length, 0);
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
assert.deepEqual(inferProvisionalRegionalCities('Jane Doe', [source])[0].supportingClaims,
  [{ sourceUrl: article.url, statement: 'Jane Doe lives in Salem, Oregon.',
    publishedAt: now, identityStatus: 'name_mention_unverified' }]);
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...source, metadata: {} }]).length, 0,
  'a search snippet is not a fetched residence claim');
assert.equal(inferProvisionalRegionalCities('Other Person', [source]).length, 0);
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...source,
  metadata: { ...source.metadata, publishedAt: '2010-01-01T00:00:00Z' },
}]).length, 0, 'known stale publications must not support a current hypothesis');

const localNews = {
  url: 'https://centraloregonnews.com/story', title: 'Local story', snippet: 'Search snippet',
  metadata: {
    fetchedExcerpt: 'BEND—A 45-year-old Bend woman was arrested Tuesday. The arrest of Jane Doe followed a report. More details followed.',
    publishedAt: now,
  },
};
assert.deepEqual(inferProvisionalRegionalCities('Jane Doe', [localNews]).map(city => [city.city, city.state]),
  [['Bend', 'OR']], 'a dated local article identifying the named resident across adjacent sentences can support a provisional city');
const midwestNews = {
  url: 'https://www.nwestiowa.com/news/example', title: 'Hartley man jailed', snippet: '',
  metadata: {
    fetchedExcerpt: 'HARTLEY—A 45-year-old Hartley man was arrested about 11 a.m. Wednesday, Dec. 17, on charges of possession. The arrest of John Example stemmed from a report.',
    publishedAt: now,
  },
};
assert.deepEqual(inferProvisionalRegionalCities('John Example', [midwestNews]).map(city => [city.city, city.state]),
  [['Hartley', 'IA']], 'the local-news phrasing seen in the production record must produce a dated candidate');
const fetchedMidwestArticle: SpectraRetrievedEvidence = {
  url: midwestNews.url, requestedUrl: midwestNews.url,
  retrievedAt: now, publishedAt: now,
  textExcerpt: midwestNews.metadata.fetchedExcerpt, observations: [],
};
assert.deepEqual(inferProvisionalRegionalCities('John Example', retrievedRegionalSources([fetchedMidwestArticle]))
  .map(city => [city.city, city.state]), [['Hartley', 'IA']],
  'a retrieved page must reach city inference even without a surviving search-result lead');
assert.equal(inferProvisionalRegionalCities('Other Person', [localNews]).length, 0,
  'a different person must not inherit the article city');
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...localNews, url: 'https://unrelatednews.com/story' }]).length, 0,
  'an ambiguous city without a source-backed state must not be guessed');
assert.equal(inferProvisionalRegionalCities('Jane Doe', [{ ...localNews,
  metadata: { ...localNews.metadata, publishedAt: '2010-01-01T00:00:00Z' },
}]).length, 0, 'a stale local article must not support this provisional estimate');
console.log('SPECTRA direct public record and provisional city checks passed');
