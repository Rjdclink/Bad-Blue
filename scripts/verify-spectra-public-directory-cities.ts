import assert from 'node:assert/strict';
import { inferPublicDirectoryCities } from '../server/services/spectra/SpectraPublicDirectoryCities';

const subject = 'Taylor Avery Morgan';
const directory = {
  url: 'https://directory.example.org/taylor',
  metadata: {
    fetchedExcerpt: 'Taylor Avery Morgan, age 41, Hartley, IA. Lived in: Spirit Lake IA, Spencer IA. Relatives: Jane. Another Person, age 42, Omaha, NE.',
  },
};
assert.deepEqual(inferPublicDirectoryCities(subject, [directory]).map(city => city.city), ['Hartley']);
assert.equal(inferPublicDirectoryCities(subject, [directory])[0].publishedAt, null,
  'retrieval date does not date the residence record');
assert.equal(inferPublicDirectoryCities(subject, [{ ...directory, metadata: {
  fetchedExcerpt: 'Taylor Avery Morgan previously lived in Hartley, IA. Lived in Spirit Lake, IA.',
} }]).length, 0, 'past locations never become the preferred current city');
assert.equal(inferPublicDirectoryCities(subject, [{ ...directory, metadata: {
  fetchedExcerpt: 'Other Person lives in Hartley, IA. Taylor Avery Morgan has no published city.',
} }]).length, 0, 'other people and prior locations cannot leak into the target');
assert.equal(inferPublicDirectoryCities(subject, [{
  url: directory.url, snippet: directory.metadata.fetchedExcerpt,
}]).length, 0, 'unretrieved search snippets cannot create directory evidence');
const reverse = inferPublicDirectoryCities(subject, [{
  url: 'https://reverse.example.net/number',
  metadata: { fetchedExcerpt: 'Taylor Avery Morgan lives in Cedar Rapids, IA. 319-555-0173' },
}], { phone: '319-555-0173' });
assert.equal(reverse[0]?.city, 'Cedar Rapids');
assert.equal(reverse[0]?.supportingClaims[0]?.identityStatus, 'public_contact_match_unverified');
assert.equal(reverse[0]?.currentPositionVerified, false);
console.log('SPECTRA public directory city and reverse-number inference verified.');
