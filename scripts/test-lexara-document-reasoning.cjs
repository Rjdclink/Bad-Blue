const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../server/lexara/LexaraDocumentReasoning.ts'), 'utf8');
function harness({ answer, live = true, searches = [] }) {
  const calls = []; const exports = {}; let i = 0;
  const dependencies = {
    '../aiProvider': { TaskPriority: { CRITICAL_USER: 5 }, generateUserText: async (task, prompt, options) => {
      calls.push({ task, prompt, options }); return { content: typeof answer === 'string' ? answer : JSON.stringify(answer),
        contributions: live ? [{ success: true, content: 'live provider output' }] : undefined };
    } },
    './LexaraAuthorityResearch': { researchLegalAuthority: async query => { calls.push({ query }); return searches[i++] || null; },
      formatAuthorityResearchForSystem: research => research ? JSON.stringify(research) : '' },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: p => { assert(dependencies[p], p); return dependencies[p]; }, setTimeout, clearTimeout, AbortController, console: { info() {} } });
  return { api: exports, calls };
}
const primary = { hasPrimaryAuthority: true, sources: [{ kind: 'primary', url: 'https://court.example.gov/forms', excerpt: 'A party must use the official petition form for this proceeding.' }] };
test('a local fallback cannot be certified as a live legal draft', async () => {
  const { api } = harness({ answer: 'DEMAND LETTER\n' + 'Local fallback text. '.repeat(100), live: false });
  await assert.rejects(api.reasonAboutLexaraDocument('draft a demand'), /No document was certified/);
});
test('drafting uses a dedicated instrument task instead of consultation prompts', async () => {
  const { api, calls } = harness({ answer: 'DRAFT' }); await api.reasonAboutLexaraDocument('draft facts');
  assert.equal(calls[0].task, 'lexara-legal-document'); assert.equal(calls[0].options.includeContributions, true);
});
test('official-form requirement requires a retrieved primary URL and matching evidence', async () => {
  const { api } = harness({ answer: { status: 'official-form', forms: [{ name: 'Petition', url: primary.sources[0].url, quote: primary.sources[0].excerpt }] }, searches: [primary] });
  const result = await api.assessLexaraDocumentRequirements('Iowa', 'Petition', 'User facts');
  assert.equal(result.status, 'official-form'); assert.equal(result.forms.length, 1);
});
test('invented form URLs cannot reach the official-form handoff', async () => {
  const { api } = harness({ answer: { status: 'official-form', forms: [{ name: 'Petition', url: 'https://invented.example/form', quote: primary.sources[0].excerpt }] }, searches: [primary] });
  assert.equal((await api.assessLexaraDocumentRequirements('Iowa', 'Petition', 'facts')).status, 'unverified');
});
test('search progressively broadens on missing authority and cannot certify an ungrounded filing', async () => {
  const { api, calls } = harness({ answer: { status: 'custom' } });
  assert.equal((await api.assessLexaraDocumentRequirements('Iowa', 'Petition', 'facts')).status, 'unverified');
  assert.equal(calls.filter(c => c.query).length, 3);
});
test('one material jurisdiction question is preserved', async () => {
  const { api } = harness({ answer: { status: 'clarification', question: 'Which court is handling the case?' }, searches: [primary] });
  const result = await api.assessLexaraDocumentRequirements('Iowa', 'Motion', 'A case is already pending');
  assert.equal(result.status, 'clarification'); assert.equal(result.question, 'Which court is handling the case?');
});
