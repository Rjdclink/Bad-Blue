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
const ranked = inferPublicDirectoryCities(subject, [
  { url: 'https://name-only.example/entry', metadata: {
    fetchedExcerpt: 'Taylor Avery Morgan lives in Boise, ID. Public listing.',
  } },
  { url: 'https://phone-bound.example/entry', metadata: {
    fetchedExcerpt: 'Taylor Avery Morgan lives in Cedar Rapids, IA. Phone: (319) 555-0173.',
  } },
], { phone: '+1 319 555 0173' });
assert.equal(ranked[0]?.city, 'Cedar Rapids',
  'the exact E.164 phone match ranks ahead of an otherwise equal name-only city');
assert.equal(ranked[0]?.supportingClaims[0]?.identityStatus, 'public_contact_match_unverified');
const unrelatedDigits = inferPublicDirectoryCities(subject, [{
  url: 'https://unrelated-digits.example/entry',
  metadata: { fetchedExcerpt: 'Taylor Avery Morgan lives in Salem, OR. Age 31. ZIP 95550. Record 173.' },
}], { phone: '+13195550173' });
assert.equal(unrelatedDigits[0]?.supportingClaims[0]?.identityStatus, 'name_mention_unverified',
  'age, ZIP and record digits must not combine into a phone match');
console.log('SPECTRA public directory city and reverse-number inference verified.');
