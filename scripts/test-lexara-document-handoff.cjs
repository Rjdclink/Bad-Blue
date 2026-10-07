const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => imports[name] || {}, console });
  return exports;
}
const { lexaraDocumentSpeech } = load('shared/lexaraDocumentSpeech.ts');
assert.equal(lexaraDocumentSpeech('Would you like PDF or DOCX?', true), 'Would you like PDF or DOCX?');
assert.equal(lexaraDocumentSpeech('What is your neighbor’s name?', true), 'What is your neighbor’s name?');
assert.equal(lexaraDocumentSpeech('How can I help you?', false), 'How can I help you?');
assert.ok(!lexaraDocumentSpeech('DEMAND LETTER\n[NAME NEEDED]\nDear Neighbor,', true).includes('[NAME'));
const registry = load('server/lexara/legalDocumentRegistry.ts');
assert.equal(registry.inferLegalDocumentNeed('I was just served with a complaint. What should I do?'), 'Answer');
assert.equal(registry.inferLegalDocumentNeed('I need to recover my security deposit back.'), 'Demand Letter');
assert.equal(registry.inferLegalDocumentNeed('I want to appeal the court judgment.'), 'Notice of Appeal');
assert.equal(registry.inferLegalDocumentNeed('What is a court complaint?'), null);
assert.equal(registry.inferLegalDocumentNeed("I don't want to file a complaint."), null);
const forms = load('server/lexara/OfficialLegalFormResolver.ts');
assert.equal(forms.resolveOfficialLegalForm({ searchedAt:'2026-10-07', sources:[
  { url:'https://example.gov/civil-cover-sheet.pdf', title:'Required Civil Cover Sheet', excerpt:'This required form must be used.' },
]}, 'Notice of Appeal').requirement, 'unverified');
assert.equal(forms.resolveOfficialLegalForm({ searchedAt:'2026-10-07', sources:[
  { url:'https://example.gov/notice-of-appeal.pdf', title:'Notice of Appeal Form', excerpt:'Required form. Use this form when filing a notice of appeal.' },
]}, 'Notice of Appeal').requirement, 'mandatory');
const draft = `DEMAND LETTER\n[DATE]\n[SENDER NAME AND ADDRESS]\n[RECIPIENT NAME AND ADDRESS]\nRe: Dog waste on my lawn in Spirit Lake, Iowa\nDear [NEIGHBOR NAME],\nYour dog has been leaving waste on my lawn. I ask that you prevent your dog from entering my property and promptly remove any waste it leaves. Please confirm how you will prevent this from recurring. I would prefer to resolve this matter cooperatively. Please contact me at [CONTACT INFORMATION] to discuss a resolution.\nSincerely,\n[SIGNATURE]`;
async function run(outputs) {
  const calls = [], warnings = [], routes = new Map();
  const mod = load('server/routes/consultation.routes.ts', {
    '../auth': { isAuthenticated() {} }, '../errorHandler': { asyncHandler: fn => fn },
    '../legalAI': { analyzeLegalIssue() { throw new Error('Civil-rights analyzer must not draft documents'); } },
    '../aiProvider': { generateLegalAnalysis: async (...args) => { calls.push(args); return outputs.shift(); } },
    '../lexara/LexaraAuthorityResearch': { researchLegalAuthority: async () => null, formatAuthorityResearchForSystem: () => '' },
    '../lexara/LexaraJurisdictionResolver': { resolveUSJurisdiction: async (_text, state) => state ? { display: state, state, country: 'United States', providers: ['verifier'] } : null },
    '../lexara/LexaraJurisdictionAuthority': {
      resolveJurisdictionAuthorityProfile: async () => null,
      formatJurisdictionAuthorityForSystem: () => '',
    },
    '../lexara/LexaraCitationVerifier': {
      verifyLegalCitationsInText: async () => [],
      formatCitationVerificationForCorrection: () => '',
    },
    '../lexara/LegalESignature': {
      assessGenericESignEligibility: () => ({ eligible: false, reason: 'test stub', authority: '' }),
      LEGALWHAT_ESIGN_CONSENT: 'test consent',
      parseSignaturePngDataUrl: () => null,
      sha256Hex: () => '0'.repeat(64),
    },
    '../lexara/OfficialLegalFormResolver': { resolveOfficialLegalForm: () => ({ requirement: 'custom_allowed', verifiedOfficial: true, localRules: [], companionDocuments: [], provenance: [] }), officialFormDirective: () => 'Custom drafting verified as permitted.' },
    '../lexara/OfficialFormFiller': { inspectOfficialForm: async () => ({ contentType: 'pdf', bytes: Buffer.from(''), fields: [], fillable: true, sourceUrl: 'https://example.gov/form.pdf' }), fillOfficialPdf: async () => Buffer.from('pdf'), fillOfficialDocx: async () => Buffer.from('docx') },
    '../lexara/FlatOfficialFormOverlay': { overlayFlatOfficialPdf: async () => Buffer.from('pdf'), validateFlatFormLayout: layout => layout },
    '../lexara/FlatFormLayoutDetector': { detectFlatFormLayout: async () => ({ anchors: [], verified: false, method: 'unavailable' }) },
    '../logger': { createLogger: () => ({ info() {}, warn: (...args) => warnings.push(args) }) },
    '../lexara/legalDocumentRegistry': registry,
  });
  mod.setupConsultationRoutes({ get() {}, post(url, ...handlers) { routes.set(url, handlers.at(-1)); } });
  let status = 200, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  await routes.get('/api/lexara/documents/generate')({ body: {
    state: 'Iowa', facts: 'I live in Spirit Lake. My neighbor’s dog keeps leaving waste on my lawn.', documentType: 'Demand Letter',
  } }, res);
  return { status, body, calls, warnings };
}
(async () => {
  const success = await run([draft]);
  assert.equal(success.status, 200); assert.equal(success.body.validated, true);
  assert.equal(success.calls[0][0], 'document-drafting');
  assert.match(success.calls[0][2].systemPrompt, /Return ONLY the document/);
  assert.match(success.calls[0][1], /No current authority was retrieved/);
  const repaired = await run(['I can help. Please tell me more.', draft]);
  assert.equal(repaired.status, 200); assert.equal(repaired.calls.length, 2);
  const rejected = await run(['I can help.', 'I can help.']);
  assert.equal(rejected.status, 422); assert.equal(rejected.body.document, undefined);
  assert.equal(rejected.warnings.length, 2);
  assert.ok(rejected.warnings.every(([, metadata]) => metadata.reason && !metadata.facts));
  console.log('PASS: spoken document replies, unchanged greeting, draft-only routing, repair, rejection and private diagnostics');
})().catch(error => { console.error(error); process.exitCode = 1; });
