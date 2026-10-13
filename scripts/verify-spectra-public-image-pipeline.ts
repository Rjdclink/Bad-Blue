import assert from 'node:assert/strict';
import {
  allowedSpectraPublicImageUrl,
  collectSpectraPublicBlueskyImages,
  collectSpectraPublicMastodonImages,
  collectSpectraPublicSocialPageImages,
  spectraSocialPageImageLeads,
} from '../server/services/spectra/SpectraPublicImageRecords';
import { htmlEvidence } from '../server/services/spectra/SpectraPublicRetrieval';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const now = new Date().toISOString();
const jpeg = Buffer.from([255, 216, 255, 217]);
const jpegResponse = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
const post = (url: string, title: string, structuredRecord?: unknown): SpectraRetrievedEvidence => ({
  url, requestedUrl: url, retrievedAt: now, publishedAt: now, title,
  structuredRecord, observations: [],
});

const blueUrl = 'https://cdn.bsky.app/img/example-original';
const bluesky = post('https://bsky.app/profile/example.bsky.social/post/abc', 'Public Bluesky post', {
  embed: { images: [
    { fullsize: blueUrl, alt: 'Public photo' },
    { fullsize: blueUrl, alt: 'Repeated CDN URL' },
  ] },
});
let blueCalls = 0;
const blue = await collectSpectraPublicBlueskyImages([bluesky], {
  fetchImpl: async (request, init) => {
    blueCalls++;
    assert.equal(String(request), blueUrl);
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return jpegResponse();
  },
});
assert.equal(blueCalls, 1, 'repeated image URLs must never redownload within a collection');
assert.equal(blue.records.length, 1);
assert.equal(blue.records[0].observations.length, 0);
assert.equal((blue.records[0].structuredRecord as any).imageBytesArchived, false);
assert.equal((blue.records[0].structuredRecord as any).captureLocationIsSubjectPosition, false);
assert.equal((blue.records[0].structuredRecord as any).captureTimeStatus, 'missing',
  'publication time cannot substitute for missing original capture time');
assert.equal((blue.records[0].structuredRecord as any).capturedAt, undefined);
assert.equal((blue.records[0].structuredRecord as any).captureGps, undefined);
assert.ok(/^[a-f0-9]{64}$/.test((blue.records[0].structuredRecord as any).contentSha256));

const mastodon = post('https://social.example/@person/123', 'Public Mastodon status', {
  media_attachments: [
    { type: 'image', url: 'https://files.social.example/media_attachments/files/1/original/photo.jpg',
      description: 'A photographed landscape' },
    { type: 'video', url: 'https://files.social.example/media_attachments/files/2/original/video.mp4' },
    { type: 'image', url: 'https://private.example/images/3.jpg' },
  ],
});
let mastodonCalls = 0;
const mastodonResult = await collectSpectraPublicMastodonImages([mastodon], {
  fetchImpl: async (request, init) => {
    mastodonCalls++;
    assert.ok(['files.social.example', 'private.example'].includes(new URL(String(request)).hostname));
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return jpegResponse();
  },
});
assert.equal(mastodonCalls, 2, 'image URLs are no longer restricted to a configured Mastodon CDN');
assert.equal(mastodonResult.records.length, 2);
assert.equal((mastodonResult.records[0].structuredRecord as any).sourcePlatform, 'Mastodon');
assert.equal((mastodonResult.records[0].structuredRecord as any).sourcePostUrl, mastodon.url);

const social = [
  ['https://www.facebook.com/people/posts/42', 'https://scontent.example.fbcdn.net/photo.jpg'],
  ['https://www.instagram.com/p/abc123/', 'https://scontent.cdninstagram.com/photo.jpg'],
  ['https://x.com/example/status/123456789', 'https://pbs.twimg.com/media/abcdef.jpg'],
] as const;
const pages = social.map(([url, image]) => {
  const page = htmlEvidence('<html><head><meta property="og:image" content="' + image
    + '"></head><body><main><p>Public image post.</p></main></body></html>', url);
  assert.deepEqual(page.publicImageUrls, [image], 'fetched first-party post HTML supplies an image lead');
  return { ...post(url, 'Public webpage'), publicImageUrls: page.publicImageUrls };
});
assert.equal(spectraSocialPageImageLeads('https://unrelated.example/post', [social[2][1]]).length, 0);
assert.deepEqual(spectraSocialPageImageLeads('https://x.com/example/status/123', [
  'https://images.other.example.net/abc.jpg', social[2][1],
]), ['https://images.other.example.net/abc.jpg', social[2][1]],
'public image metadata is no longer restricted to hardcoded provider CDN hosts');
assert.equal(allowedSpectraPublicImageUrl('http://images.other.example.net/photo.jpg', 'X', social[2][0]),
  'http://images.other.example.net/photo.jpg', 'public HTTP image URLs remain eligible');
assert.equal(allowedSpectraPublicImageUrl('https://images.other.example.net/photo.jpg', 'Facebook',
  social[0][0]), 'https://images.other.example.net/photo.jpg');
assert.equal(allowedSpectraPublicImageUrl('javascript:alert(1)', 'X', social[2][0]), null);
assert.equal(allowedSpectraPublicImageUrl('http://user:secret@example.net/photo.jpg', 'X', social[2][0]), null);
let socialCalls = 0;
const result = await collectSpectraPublicSocialPageImages(pages, {
  fetchImpl: async (_request, init) => {
    socialCalls++;
    assert.equal(init?.redirect, 'manual', 'image redirects are handled explicitly without credentials');
    return jpegResponse();
  },
});
assert.equal(socialCalls, 3);
assert.equal(result.records.length, 3);
assert.deepEqual(result.records.map(item => (item.structuredRecord as any).sourcePlatform),
  ['Facebook', 'Instagram', 'X']);
const followed: string[] = [];
const redirected = await collectSpectraPublicSocialPageImages([pages[0]], {
  fetchImpl: async (request, init) => {
    followed.push(String(request));
    assert.equal(init?.redirect, 'manual', 'public redirects are evaluated one hop at a time');
    return followed.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://other-cdn.example.net/photo.jpg' } })
      : jpegResponse();
  },
});
assert.equal(followed.length, 2, 'a public CDN redirect is followed');
assert.equal(redirected.records.length, 1);
assert.equal(redirected.records[0].url, 'https://other-cdn.example.net/photo.jpg');
assert(result.records.every(item => item.observations.length === 0));
assert(result.records.every(item => (item.structuredRecord as any).currentPositionVerified === false));
const oversized = await collectSpectraPublicSocialPageImages([pages[0]], {
  fetchImpl: async () => new Response(jpeg, {
    headers: { 'content-type': 'image/jpeg', 'content-length': '3000001' },
  }),
});
assert.equal(oversized.failed, 1);
assert.equal(oversized.records.length, 0);
const disguised = await collectSpectraPublicSocialPageImages([pages[0]], {
  fetchImpl: async () => new Response('<html>login page</html>', {
    headers: { 'content-type': 'image/jpeg' },
  }),
});
assert.equal(disguised.failed, 1, 'non-image bytes must never be treated as inspected photos');
const external = htmlEvidence('<meta property="og:image" content="' + social[2][1] + '">',
  'https://unrelated.example/story');
assert.equal(external.publicImageUrls, undefined, 'a generic site cannot launder social CDN URLs');

// Four early Facebook results must not consume every image slot before the
// Instagram and X result pages are processed.
const crowded: SpectraRetrievedEvidence[] = [
  ...Array.from({ length: 4 }, (_, i) => post(
    'https://www.facebook.com/fake/posts/' + (i + 10), 'Public webpage')),
  ...Array.from({ length: 4 }, (_, i) => post(
    'https://www.instagram.com/p/example' + (i + 10) + '/', 'Public webpage')),
  ...Array.from({ length: 4 }, (_, i) => post(
    'https://x.com/fake/status/' + (123456789100 + i), 'Public webpage')),
].map((page, i) => ({
  ...page, publicImageUrls: ['https://images.example.invalid/photo-' + i + '.jpg'],
}));
const fair = await collectSpectraPublicSocialPageImages(crowded, {
  fetchImpl: async () => jpegResponse(),
});
assert.equal(fair.attempted, 6, 'bounded cross-platform media budget');
assert.equal(fair.failed, 0);
assert.deepEqual(fair.records.map(record => (record.structuredRecord as any).sourcePlatform),
  ['Facebook', 'Instagram', 'X', 'Facebook', 'Instagram', 'X'],
  'each public platform receives a share of the bounded retrieval budget');

console.log('SPECTRA public social image pipeline passed: cross-provider public image URLs and redirects, Bluesky, Mastodon, Facebook, Instagram, X, deduplication, bounded bytes and EXIF metadata.');
