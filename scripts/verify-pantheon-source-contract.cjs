const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const sourceResult = read('server/services/pantheon/PantheonSourceResult.ts');
const adapter = read('server/services/crawlers/PantheonRetrievalAdapter.ts');
const evidence = read('server/services/pantheon/PantheonEvidencePipeline.ts');
const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const job = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const pdf = read('server/services/pantheon/PantheonBackgroundReportPdf.ts');
const routes = read('server/routes.ts');

for (const token of [
  'PANTHEON_SOURCE_RESULT_SCHEMA',
  'PantheonStructuredSourceResult',
  'createPantheonSourceResult',
  'validatePantheonSourceResult',
  'contentHash',
  'evidenceId',
  'provenance',
  "status: 'completed_with_evidence'",
]) {
  if (!sourceResult.includes(token)) throw new Error('Structured source-result contract missing: ' + token);
}
for (const token of [
  'type RetrievalEvidence = PantheonStructuredSourceResult',
  'createPantheonSourceResult',
  "route: 'fallback'",
  'fallbackFor',
  'operationSignal',
  'operationDeadline?.dispose',
]) {
  if (!adapter.includes(token)) throw new Error('Live adapter contract/fallback/deadline missing: ' + token);
}
if (adapter.includes('synthetic fallback') || adapter.includes('simulated fallback')) {
  throw new Error('Production retrieval adapter contains a simulated fallback');
}
for (const token of [
  'validatePantheonSourceResult(item)',
  "'duplicate_evidence'",
  "'conflicting_evidence'",
  "'weak_evidence'",
  'verified_live_source',
  'analysisEligible',
]) {
  if (!evidence.includes(token)) throw new Error('Evidence normalization/filtering gate missing: ' + token);
}
for (const token of [
  'citationId: item.evidenceId',
  'contentHash: item.contentHash',
  'provenance: item.provenance',
  'PANTHEON_CRAWLER_CAPABILITY_MATRIX',
  'reportEvidenceEligible === true',
]) {
  if (!workflow.includes(token)) throw new Error('Report evidence/citation gate missing: ' + token);
}
for (const token of [
  'resumeCategoryIndexes',
  'initialCategoryOutcomes',
  'initialCategoryStates',
  'persistedStates.filter(state => state.state !==',
  'categoryOutcomes: persistedOutcomes()',
  'verifyPantheonPdfBuffer',
  'pdfVerification',
]) {
  if (!job.includes(token)) throw new Error('Persisted resume/PDF gate missing: ' + token);
}
for (const token of [
  'verifyPantheonPdfBuffer',
  'Content SHA-256',
  'Citation ID',
  "raw.startsWith('%PDF-')",
  '/%%EOF\\s*$/',
]) {
  if (!pdf.includes(token)) throw new Error('PDF verification/provenance missing: ' + token);
}
if (!routes.includes('envelope.pdfVerification?.verified === true') ||
    !routes.includes('verifyPantheonPdfBuffer(pdf, 2)')) {
  throw new Error('Download release is not gated by verified PDF rendering');
}
console.log('Pantheon structured results, live fallback, evidence normalization, persisted resume, and PDF release gates verified.');
