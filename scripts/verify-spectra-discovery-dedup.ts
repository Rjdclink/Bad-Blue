import assert from 'node:assert/strict';
import { takeUnseenSpectraQueries } from '../server/services/spectra/SpectraDiscoveryDedup';

// Fictional terms only; tests do not query a network or investigate people.
const seen = new Set<string>();
assert.deepEqual(takeUnseenSpectraQueries([
  '  historic  library   address ', 'historic library address',
  'HISTORIC LIBRARY ADDRESS', 'public imagery satellite dates', '',
  'regional archive listings',
], seen, 2), ['historic library address', 'public imagery satellite dates']);
assert.equal(seen.size, 2, 'unselected queries must not be marked dispatched');
assert.deepEqual(takeUnseenSpectraQueries([
  'historic library address', 'regional archive listings',
  'REGIONAL ARCHIVE LISTINGS', 'public imagery satellite dates',
  'official public metadata',
], seen, 6), ['regional archive listings', 'official public metadata']);
assert.equal(seen.size, 4);
assert.deepEqual(takeUnseenSpectraQueries(['historic library address'], seen), []);
assert.deepEqual(takeUnseenSpectraQueries(['new provider'], seen, 0), []);
assert.equal(seen.has('new provider'), false);
assert.deepEqual(takeUnseenSpectraQueries([' NEW    PROVIDER '], seen), ['NEW PROVIDER']);
const nextRequest = new Set<string>();
assert.deepEqual(takeUnseenSpectraQueries(['historic library address'], nextRequest),
  ['historic library address'], 'new acquisitions can refresh changed source records');
assert.deepEqual(takeUnseenSpectraQueries(['ABC', 'ＡＢＣ'], new Set<string>()),
  ['ABC'], 'Unicode-equivalent queries should be one request');
console.log('SPECTRA recursive internet-discovery fingerprint checks passed.');
