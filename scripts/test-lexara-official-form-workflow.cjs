// Nationwide official-form workflow regression fixtures. No network, personal data, or filing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const root = path.resolve(__dirname, '..');

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const requireLocal = key => Object.hasOwn(dependencies, key) ? dependencies[key] : require(key);
  new Function('require', 'module', 'exports', output)(requireLocal, module, module.exports);
  return module.exports;
}

const request = load('server/lexara/OfficialFormRequest.ts');
const resolver = load('server/lexara/OfficialLegalFormResolver.ts');
const filler = load('server/lexara/OfficialFormFiller.ts', {
  './OfficialLegalFormResolver': resolver,
});
const overlay = load('server/lexara/FlatOfficialFormOverlay.ts');

for (const userRequest of [
  'Please get me the Iowa child support modification form.',
  'I need a Texas court application form.',
  'Can you grab the California family-law court form?',
  'Download the federal court AO filing form.',
  'Show me the New York county court cover sheet.',
  'Please provide the Virginia court petition.',
]) assert.equal(request.isLexaraOfficialFormDeliveryRequest(userRequest), true, userRequest);
for (const inquiry of [
  'What is a court form?',
  'Explain which forms I need.',
  'How do I complete that form?',
  'I want to know which forms may exist.',
  'Do not get that form.',
]) assert.equal(request.isLexaraOfficialFormDeliveryRequest(inquiry), false, inquiry);

const source = (host, title, excerpt = 'Current official form') => ({
  kind: 'primary', title, excerpt, url: 'https://' + host + '/documents/form.pdf',
});
const sources = { searchedAt: '2026-10-17', sources: [
  source('www.iowacourts.gov', 'Iowa Child Support Modification Application Form'),
  source('www.txcourts.gov', 'Texas Child Support Modification Application Form'),
] };
const selected = resolver.resolveOfficialLegalForm(sources, 'Child Support Modification Application Form', undefined, ['iowacourts.gov']);
assert.match(selected.url, /iowacourts/);
assert.equal(selected.verifiedOfficial, true);
const incorrectCourt = resolver.resolveOfficialLegalForm(sources, 'Child Support Modification Application Form', undefined, ['unknowncourt.gov']);
assert.equal(incorrectCourt.verifiedOfficial, false);
const retired = resolver.resolveOfficialLegalForm({ searchedAt: '2026-10-17', sources: [
  source('www.iowacourts.gov', 'Superseded Child Support Modification Application Form'),
] }, 'Child Support Modification Application Form');
assert.equal(retired.verifiedOfficial, false);
const localCourt = resolver.resolveOfficialLegalForm({ searchedAt: '2026-10-17', sources: [
  source('forms.statejudiciary.org', 'County Motion Form'),
] }, 'County Motion Form', undefined, ['statejudiciary.org']);
assert.equal(localCourt.verifiedOfficial, true);


for(const phrase of [
  'I need to change my child support order.',
  'We need to apply for guardianship.',
  'I want to file for custody.',
]) assert.equal(request.isLexaraOfficialFormDeliveryRequest(phrase),true,phrase);
for(const question of [
  'How do I modify child support?',
  'What does custody mean?',
]) assert.equal(request.isLexaraOfficialFormDeliveryRequest(question),false,question);

const overlapping = { searchedAt:'2026-10-17', sources:[
  source('www.iowacourts.gov','Application to Modify Child Support Only, Form 301'),
  source('hhs.iowa.gov','Request for Review and Modification of Child Support'),
  source('www.iowacourts.gov','Confidential Information Form 303','child support case'),
  source('www.mncourts.gov','Application to Modify Child Support'),
]};
const alternatives = resolver.rankOfficialLegalForms(overlapping,'change my child support order',undefined,['iowacourts.gov','hhs.iowa.gov']);
assert.equal(alternatives.length,2,'infer related procedures without an exact form name');
assert.equal(resolver.officialFormNeedsClarification(alternatives),true);
const choices=alternatives.map(candidate=>candidate.form.url);
assert.equal(resolver.selectClarifiedOfficialForm(alternatives,'first',choices)?.url,choices[0]);
assert.equal(resolver.selectClarifiedOfficialForm(alternatives,'second',choices)?.url,choices[1]);
assert.match(resolver.selectClarifiedOfficialForm(alternatives,'agency',choices)?.url,/hhs\.iowa\.gov/);
assert.match(resolver.selectClarifiedOfficialForm(alternatives,'court',choices)?.url,/iowacourts\.gov/);
assert.equal(resolver.selectClarifiedOfficialForm(alternatives,'first',['https://untrusted.example.invalid/form.pdf']),null);
const clientSource=fs.readFileSync(path.join(root,'client/src/components/LexaraConversation.tsx'),'utf8');
const gateStart=clientSource.indexOf('const NON_PERSON_SPECTRA_TARGET_RE');
const gateEnd=clientSource.indexOf('type ConversationPhase',gateStart);
assert(gateStart>=0 && gateEnd>gateStart);
const gateScript=ts.transpileModule(clientSource.slice(gateStart,gateEnd),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const spectraTarget=new Function(gateScript+'\nreturn spectraTargetFromPrompt;')();
assert.equal(spectraTarget('I need you to find the modification of child support obligation, the official form from Clay County, Iowa.'),null);
assert.equal(spectraTarget('I need to change my child support order.'),null);
assert.equal(spectraTarget('Find my friend'), 'my friend');
assert(clientSource.includes('data?.needsFormClarification === true'));
assert(clientSource.includes('(!pendingDocument.officialFormDelivery || !!officialFormPreview)'));
console.log('PASS: legal-purpose inference, competing court/agency form clarification, source revalidation, and no Spectra interference');

(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612,792]);
  const fields = pdf.getForm();
  const applicant = fields.createTextField('Applicant Name');
  applicant.addToPage(page, { x: 80, y: 650, width: 200, height: 22 });
  applicant.enableRequired();
  const employer = fields.createTextField('Employer');
  employer.addToPage(page, { x: 80, y: 400, width: 200, height: 22 });
  const confirmed = fields.createCheckBox('Confirmed');
  confirmed.addToPage(page, { x: 80, y: 200, width: 16, height: 16 });
  const bytes = Buffer.from(await pdf.save());
  const originalFetch = global.fetch;
  try {
    global.fetch = async url => {
      const response = new Response(bytes, { status: 200 });
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    };
    const inspected = await filler.inspectOfficialForm({
      verifiedOfficial: true, url: 'https://court.gov/application.pdf',
    });
    assert.equal(inspected.fillable, true);
    assert.equal(inspected.fields.length, 3);
    assert.equal(inspected.fields.find(f => f.name === 'Applicant Name').required, true);
    assert.equal(inspected.fields.find(f => f.name === 'Employer').required, false);
    assert.deepEqual(inspected.fields.map(f => f.name), ['Applicant Name','Employer','Confirmed']);

    const filled = await filler.fillOfficialPdf(inspected, { 'Applicant Name': 'Example User' }, false);
    const reopened = await PDFDocument.load(filled);
    assert.equal(reopened.getForm().getTextField('Applicant Name').getText(), 'Example User');
    assert.equal(reopened.getForm().getTextField('Employer').getText(), undefined);
    assert.equal(reopened.getForm().getFields().length, 3); // Remains editable for next answer.
    await assert.rejects(() => filler.fillOfficialPdf(inspected, { Confirmed: 'unknown answer' }, false));
  } finally {
    global.fetch = originalFetch;
  }

  const sample = await PDFDocument.create();
  sample.addPage([612,792]);
  const flat = { contentType: 'pdf', fillable: false, bytes: Buffer.from(await sample.save()), fields: [] };
  const anchor = { page: 0, label: 'Name', x: 100, y: 100, width: 180, height: 20, confidence: 0.98 };
  const layout = { verified: true, method: 'ocr-coordinates', anchors: [anchor] };
  const overlaid = await overlay.overlayFlatOfficialPdf(flat, layout, { Name:'Example User' });
  assert.equal((await PDFDocument.load(overlaid)).getPageCount(), 1);
  assert.equal(overlay.validateFlatFormLayout({ ...layout, anchors:[anchor,anchor] }).verified, false);
  await assert.rejects(() => overlay.overlayFlatOfficialPdf(flat, {
    ...layout, anchors: [{ ...anchor, page:1 }],
  }, { Name:'Example User' }));

  console.log('PASS nationwide official form intent, source selection, original PDF prefill, optional fields, and conservative flat-form placement');
})().catch(error => { console.error(error); process.exitCode = 1; });
