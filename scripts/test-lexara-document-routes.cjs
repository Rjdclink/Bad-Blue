const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const PDFDocument = require('pdfkit');
const root = path.join(__dirname, '..');
class Unavailable extends Error {}
function harness(requirement = { status: 'custom', forms: [], evidence: 'Verified primary evidence' }, output = 'DEMAND LETTER\n' + 'Please stop the identified interference with the property. '.repeat(20)) {
  const exports = {}; const routes = new Map();
  const registry = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'server/lexara/legalDocumentRegistry.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: registry });
  const dependencies = {
    '../auth': { isAuthenticated() {} }, '../errorHandler': { asyncHandler: f => f },
    '../logger': { createLogger: () => ({ info() {}, error() {} }) },
    'pdfkit': PDFDocument, 'archiver': () => {},
    '../lexara/legalDocumentRegistry': registry,
    '../lexara/LexaraDocumentReasoning': { LexaraDocumentUnavailable: Unavailable,
      assessLexaraDocumentRequirements: async () => requirement,
      reasonAboutLexaraDocument: async () => { if (output instanceof Error) throw output; return output; } },
  };
  const compiled = ts.transpileModule(fs.readFileSync(process.env.LEXARA_CONSULTATION_ROUTE_SOURCE || path.join(root, 'server/routes/consultation.routes.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, require: p => dependencies[p] || {}, Buffer, console });
  const register = (url, ...handlers) => routes.set(url, handlers.at(-1));
  exports.setupConsultationRoutes({ get: register, post: register });
  return async (url, body) => {
    const result = { status: 200, headers: {}, body: null };
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; },
      setHeader(name, value) { result.headers[name] = value; }, send(body) { result.body = body; } };
    await routes.get(url)({ body }, res); return result;
  };
}
test('official forms stop custom drafting and return verified source handoff', async () => {
  const run = harness({ status: 'official-form', forms: [{ name: 'Official Petition', url: 'https://court.example.gov/form' }], evidence: '' });
  const res = await run('/api/lexara/documents/generate', { state: 'Iowa', facts: 'facts', documentType: 'Petition' });
  assert.equal(res.status, 422); assert.equal(res.body.requirements.forms.length, 1); assert.equal(res.body.validated, undefined);
});
