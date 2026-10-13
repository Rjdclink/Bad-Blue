// Behavioral regression checks using actual shared, server and client functions.
// Synthetic metadata only; no external requests or personal records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shared = read('shared/spectraTimestampClues.ts').replace(/^export /gm, '');
const route = read('server/routes/spectra.routes.ts');
const phone = route.slice(route.indexOf('function extractPhoneNumber'), route.indexOf('\nfunction extractDeviceRef'));
const declaration = route.match(/^const PHONE_CANDIDATE_RE = .+$/m)[0];
const scope = {};
vm.runInNewContext(compile(shared + '\n' + declaration + '\n' + phone + '\nthis.extract = extractPhoneNumber;'), scope);
for (const text of ['2026-10-13', '2026:10:13 10:45:11', '2026/10/13', '2026-10-13T12:45:11.123-05:00', '10/13/2026', '13/10/2026']) {
  assert.equal(scope.extract(text), undefined, text + ' is not a phone');
  assert.equal(scope.extract(`${text}; phone +1 (202) 555-0100`), '+1 (202) 555-0100', 'date cannot hide the following phone');
}
assert.equal(scope.extract('Contact +44 20 7946 0958'), '+44 20 7946 0958');
assert.equal(scope.extract('2025550100'), '2025550100');
const client = read('client/src/pages/spectra.tsx');
assert(client.includes('withoutSpectraTimestamps(`${target} ${details}`)'), 'visible clue status uses the same date filter');
console.log('PASS phone extraction rejects dates and preserves actual supplied numbers');
console.log('PASS client phone status and server share timestamp exclusion');
