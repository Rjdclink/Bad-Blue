import assert from 'node:assert/strict';
import { collectSpectraPublicCourtRecords } from '../server/services/spectra/SpectraPublicCourtRecords';

const absent = await collectSpectraPublicCourtRecords('Example Person', { token: '' });
assert.equal(absent.status, 'unconfigured');

let requested = '';
const result = await collectSpectraPublicCourtRecords('Example Person', {
  token: 'fixture-token',
  search: async (url, _token) => {
    requested = url.toString();
    return { results: [
      { caseName: 'Example Person v. City', court: 'District Court', dateFiled: '2017-01-02',
        docket_absolute_url: '/docket/123/example-person-v-city/' },
      { caseName: 'Other Person v. City', docket_absolute_url: '/docket/124/other-person/' },
      { caseName: 'Example Person v. City', docket_absolute_url: 'https://attacker.invalid/docket/1/' },
    ] };
  },
});
assert.match(requested, /type=r/);
assert.equal(result.status, 'ok');
assert.equal(result.records.length, 1);
assert.equal(result.records[0].publishedAt, '2017-01-02T00:00:00.000Z');
assert.equal(result.records[0].observations.length, 0);
assert.deepEqual(Object.keys(result.records[0].structuredRecord as object).sort(),
  ['caseName', 'court', 'dateFiled', 'docketNumber', 'docketUrl'].sort());
console.log('Spectra public court records verified');
