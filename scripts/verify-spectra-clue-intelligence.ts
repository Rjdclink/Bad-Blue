import assert from 'node:assert/strict';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  extractStreetAddressHint,
  extractLocationClues,
} from '../server/services/geoconsole/city-state-geocoder';

const conversational = 'Located in Spirit Lake, Iowa, near Arbai, 109 27th Street.';
const address = extractStreetAddressHint(conversational);
assert.ok(address, 'street address should be extracted from conversational clue');
assert.equal(address?.street.toLowerCase(), '109 27th street');
assert.equal(address?.city, 'Spirit Lake');
assert.equal(address?.state, 'IA');

const regional = extractCityStateHint(conversational);
assert.equal(regional?.city, 'Spirit Lake');
assert.equal(regional?.state, 'IA');

const clues = extractLocationClues(conversational);
assert.ok(clues.some(value => /109 27th street/i.test(value)), 'street clue must be preserved');
assert.ok(clues.some(value => /Spirit Lake, IA/i.test(value)), 'regional clue must be preserved');

for (const natural of [
  'He is at 109 27th Street in Spirit Lake Iowa',
  'Try 109 27th Street, Spirit Lake, IA',
  'Last known at 109 27th Street near Spirit Lake, Iowa',
  'The address is 109 27th Street; Spirit Lake Iowa',
]) {
  assert.ok(extractStreetAddressHint(natural), 'natural phrasing lost street clue: ' + natural);
}

assert.equal(extractFreeformLocationHint('located in Spirit Lake, Iowa'), 'Spirit Lake, Iowa');
console.log('SPECTRA clue-intelligence verification passed.');
