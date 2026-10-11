import assert from 'node:assert/strict';
import { collectSpectraPhoneOrigin, parsePhoneOrigin } from '../server/services/spectra/SpectraPhoneOrigin';
import { inferPublicDirectoryCities } from '../server/services/spectra/SpectraPublicDirectoryCities';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const url = 'https://localcallingguide.com/lca_prefix.php?npa=712&nxx=209';
const table = '712-209 7 Estherville IA SWITCH 6570 CELLCO PARTNERSHIP DBA VERIZON WIRELESS - IA '
  + '712-209 8 Estherville IA SWITCH 6570 CELLCO PARTNERSHIP DBA VERIZON WIRELESS - IA '
  + '712-209 9 Other Town IA SWITCH';
assert.equal(parsePhoneOrigin(table, '712-209', '8', url)?.city, 'Estherville');
assert.equal(parsePhoneOrigin(table, '712-209', '8', url)?.currentPositionVerified, false);
assert.equal(parsePhoneOrigin(table, '712-209', '5', url), null);
const collected = await collectSpectraPhoneOrigin('712-209-8254', async targets => [{
  url, requestedUrl: targets[0], retrievedAt: new Date().toISOString(),
  textExcerpt: table, observations: [],
} as SpectraRetrievedEvidence]);
assert.equal(collected.origin?.block, '8');
assert.equal(collected.records.length, 1, 'the actual retrieved source enters the evidence archive');
const personCities = inferPublicDirectoryCities('Taylor Avery Morgan', [{
  url: 'https://directory.example.org/taylor',
  metadata: { fetchedExcerpt: 'Taylor Avery Morgan, age 41, Hartley, IA. Lived in: Spirit Lake IA, Spencer IA.' },
}]);
const chosen = personCities[0] || collected.origin;
assert.equal(chosen?.city, 'Hartley', 'person-specific residence outranks the older number assignment');
assert.equal((await collectSpectraPhoneOrigin('not a phone', async () => {
  throw new Error('invalid number must not request a source');
})).records.length, 0);
console.log('SPECTRA phone prefix assignment and archive checks passed.');
