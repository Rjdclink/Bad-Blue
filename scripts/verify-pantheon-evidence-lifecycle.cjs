const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const entity = read('server/services/pantheon/PantheonEntityResolution.ts');
const evidence = read('server/services/pantheon/PantheonEvidencePipeline.ts');
const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const submission = read('server/services/pantheon/PantheonJobSubmission.ts');
const store = read('server/services/pantheon/PantheonReportStore.ts');
const routes = read('server/routes.ts');
const job = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const registry = read('server/services/pantheon/PantheonSovereignSourceRegistry.ts');
const pdf = read('server/services/pantheon/PantheonBackgroundReportPdf.ts');
const client = read('client/src/components/DoomsdayClockSelector.tsx');

for (const token of ['exact_normalized_name','all_name_tokens','first_last_name','fuzzy_normalized_name','location_correlates','metadata_subject_conflict','score']) {
  if (!entity.includes(token)) throw new Error('Entity-resolution invariant missing: ' + token);
}
for (const token of ['simulation_or_test_output','verified_live_source','requireVerifiedPantheonEvidence','provenance','subject_mismatch']) {
  if (!evidence.includes(token)) throw new Error('Verified evidence invariant missing: ' + token);
}
if (!workflow.includes('coverageGaps') || !workflow.includes("reportCompleteness = unresolved.length === 0") ||
    !job.includes('assessPantheonReportRelease') || !job.includes('if (!releaseAssessment.eligible)') ||
    pdf.includes('PARTIAL REPORT') || pdf.includes('Coverage Gaps & Exact Omissions')) {
  throw new Error('Incomplete or zero-evidence work can still become a customer-facing report');
}
for (const token of ['consent_required','invalid_search_depth','invalid_idempotency_key','normalize(\'NFKC\')']) {
  if (!submission.includes(token)) throw new Error('Submission validation invariant missing: ' + token);
}
if (!client.includes('consentAccepted') || !routes.includes("req.get('Idempotency-Key')") ||
    !routes.includes('validatePantheonJobSubmission')) {
  throw new Error('Consent and idempotency are not wired from UI to server');
}
for (const token of ['createIdempotentPantheonReportRecord','idempotencyDigest','flag: \'wx\'','claimIdempotentReportId']) {
  if (!store.includes(token)) throw new Error('Recoverable idempotent job invariant missing: ' + token);
}
if (!workflow.includes('initializePantheonCategoryPlans') || !job.includes('categoryStates') ||
    !job.includes('initializePantheonCategoryPlans')) {
  throw new Error('All category source plans are not initialized and persisted before retrieval');
}
if (!registry.includes('preflightPantheonSourceTargets') || !registry.includes("disposition: 'excluded'") ||
    registry.includes("const replacement = 'https://www.bing.com/search") || !workflow.includes('sourcePreflightIssues')) {
  throw new Error('Source registry preflight and direct-source fallback invariant missing');
}
console.log('Pantheon entity matching, release gating, submission persistence, idempotency, source planning, and preflight verified.');
