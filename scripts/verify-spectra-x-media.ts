import assert from 'node:assert/strict';
import { collectSpectraXPostMedia, spectraXPostId } from '../server/services/spectra/SpectraXPostMedia';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const now = new Date().toISOString();
function page(url: string): SpectraRetrievedEvidence {
  return { url, requestedUrl: url, title: 'Public webpage', retrievedAt: now, observations: [] };
}
assert.equal(spectraXPostId('https://x.com/fake_account/status/1234567890123'), '1234567890123');
assert.equal(spectraXPostId('https://twitter.com/i/web/status/1234567890123'), '1234567890123');
for (const rejected of [
  'http://x.com/account/status/1234567890123',
  'https://x.com@attacker.invalid/account/status/1234567890123',
  'https://x.com/account/status/1234567890123/media',
  'https://127.0.0.1/account/status/1234567890123',
  'https://x.com/account/status/123',
  'https://instagram.com/account/status/1234567890123',
]) assert.equal(spectraXPostId(rejected), null);

const source = page('https://x.com/fake_account/status/1234567890123');
const source2 = page('https://x.com/other_fake/status/9876543210987');
assert.equal((await collectSpectraXPostMedia([source], { token: ' ' })).attempted, 0);

let calls = 0;
const retrieved = await collectSpectraXPostMedia([source, source, source2], {
  token: 'synthetic-token',
  fetchImpl: async (url, init) => {
    calls++;
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://api.x.com');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-token');
    assert.equal(target.searchParams.get('expansions'), 'attachments.media_keys');
    assert.ok(target.searchParams.get('media.fields')?.includes('url'));
    const id = target.pathname.split('/').at(-1);
    return new Response(JSON.stringify({
      data: { id, created_at: now, attachments: { media_keys: ['photo_1', 'video_2'] } },
      includes: { media: [
        { media_key: 'photo_1', type: 'photo', url: 'https://pbs.twimg.com/media/synthetic.jpg' },
        { media_key: 'photo_1', type: 'photo', url: 'https://pbs.twimg.com/media/synthetic.jpg' },
        { media_key: 'video_2', type: 'video', url: 'https://pbs.twimg.com/media/other.mp4' },
        { media_key: 'not_in_post', type: 'photo', url: 'https://pbs.twimg.com/media/other.jpg' },
      ] },
    }), { headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(calls, 2, 'deduplicate the same public post before authorization requests');
assert.equal(retrieved.status, 'complete');
assert.equal(retrieved.attempted, 2);
assert.equal(retrieved.retrieved, 2);
assert.equal(retrieved.failed, 0);
assert.deepEqual(retrieved.posts[0].publicImageUrls, ['https://pbs.twimg.com/media/synthetic.jpg']);
assert.deepEqual(retrieved.posts[0].observations, [], 'image leads are never location observations');
assert.equal(retrieved.posts[0].url, source.url);
assert.ok(!JSON.stringify(retrieved).includes('synthetic-token'), 'the API credential must never enter records');

const thumbnailPage: SpectraRetrievedEvidence = {
  ...source, publicImageUrls: ['https://thumbnails.example.org/old-share.jpg'],
};
const prioritized = await collectSpectraXPostMedia([thumbnailPage], {
  token: 'synthetic-token',
  fetchImpl: async (request) => {
    const id = new URL(String(request)).pathname.split('/').at(-1);
    return new Response(JSON.stringify({
      data: { id, attachments: { media_keys: ['photo_1'] } },
      includes: { media: [{ type: 'photo', media_key: 'photo_1',
        url: 'https://pbs.twimg.com/media/source-photo.jpg' }] },
    }), { headers: { 'content-type': 'application/json' } });
  },
});
assert.deepEqual(prioritized.posts[0].publicImageUrls, [
  'https://pbs.twimg.com/media/source-photo.jpg',
  'https://thumbnails.example.org/old-share.jpg',
], 'official attached post photo must precede incidental share thumbnail');

const lateAbort = new AbortController();
const ignoredAbort = await collectSpectraXPostMedia([source], {
  token: 'synthetic-token', signal: lateAbort.signal,
  fetchImpl: async (request) => {
    // Provider mock deliberately ignores fetch cancellation and returns late.
    lateAbort.abort();
    return new Response(JSON.stringify({
      data: { id: new URL(String(request)).pathname.split('/').at(-1),
        attachments: { media_keys: ['photo_1'] } },
      includes: { media: [{ type: 'photo', media_key: 'photo_1',
        url: 'https://pbs.twimg.com/media/not-admissible.jpg' }] },
    }), { headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(ignoredAbort.posts.length, 0,
  'a cancelled investigation must never admit late image leads');
assert.equal(ignoredAbort.status, 'partial');

const unavailable = await collectSpectraXPostMedia([source], {
  token: 'synthetic-token',
  fetchImpl: async () => new Response(JSON.stringify({ errors: [{ code: 403 }] }), {
    status: 403, headers: { 'content-type': 'application/json' },
  }),
});
assert.equal(unavailable.status, 'partial');
assert.equal(unavailable.failed, 1);
assert.equal(unavailable.retrieved, 0);

const forged = await collectSpectraXPostMedia([source], {
  token: 'synthetic-token',
  fetchImpl: async () => new Response(JSON.stringify({
    data: { id: 'not-the-post', attachments: { media_keys: ['fake'] } },
    includes: { media: [{ media_key: 'fake', type: 'photo', url: 'https://img.example/x.jpg' }] },
  }), { headers: { 'content-type': 'application/json' } }),
});
assert.equal(forged.posts.length, 0, 'the returned post ID must match the requested post');

const aborted = new AbortController();
aborted.abort();
assert.equal((await collectSpectraXPostMedia([source], {
  token: 'synthetic-token', signal: aborted.signal,
})).attempted, 0, 'cancelled searches never start a new provider request');

console.log('Spectra official X media expansion: guarded source URLs, fixed token origin, media keys, bounded requests, error reporting and no location promotion.');
