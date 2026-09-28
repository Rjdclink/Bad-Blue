const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsFixture = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../server/lexara/LexaraResearchIntentRouter.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsFixture });
for (const prompt of ['How do I file for divorce?', 'What forms do I need for custody?', 'Can I evict a tenant?', 'I need to file for bankruptcy.']) {
  test('procedural legal intent: ' + prompt, () => {
    assert.equal(exportsFixture.decideLexaraResearchNeed(prompt).objectiveKind, 'legal-authority');
  });
}
for (const prompt of ['Where does Jane Avery work?', 'Find Jane Avery divorce records', 'What is the current temperature?']) {
  test('external factual intent remains external: ' + prompt, () => {
    assert.notEqual(exportsFixture.decideLexaraResearchNeed(prompt).objectiveKind, 'legal-authority');
  });
}
