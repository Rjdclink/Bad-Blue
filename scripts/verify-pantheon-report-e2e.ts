import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generatePantheonBackgroundReportPdf,
  verifyPantheonPdfBuffer,
} from '../server/services/pantheon/PantheonBackgroundReportPdf';
import { createPantheonSourceResult } from '../server/services/pantheon/PantheonSourceResult';
import {
  dedupePantheonEvidence,
  processPantheonEvidence,
  requireVerifiedPantheonEvidence,
} from '../server/services/pantheon/PantheonEvidencePipeline';
import {
  initializePantheonCategoryPlans,
  PANTHEON_REPORT_CATEGORIES,
} from '../server/services/pantheon/PantheonCategoryWorkflow';
import { validatePantheonJobSubmission } from '../server/services/pantheon/PantheonJobSubmission';
import {
  assessPantheonCategoryOutcome,
  assessPantheonInvestigation,
  assessPantheonReportRelease,
  isLivePantheonCrawlerAudit,
} from '../server/services/pantheon/PantheonInvestigationController';

async function main() {
  const submission = validatePantheonJobSubmission({
    name: 'Jane Example',
    location: 'Sioux Falls, SD',
    searchDepth: 2,
    consent: true,
  }, 'pantheon-e2e-1234567890');
  if (submission.searchDepth !== 2 || !submission.consent.accepted) throw new Error('submission validation failed');

  const plans = initializePantheonCategoryPlans({
    name: submission.name,
    location: submission.location,
    searchDepth: submission.searchDepth,
    budgetMs: 20 * 60_000,
  });
  if (plans.length !== 30 || plans.some(plan => plan.state !== 'pending' || !plan.sourcePlan.urls.length)) {
    throw new Error('all 30 pending source plans were not initialized');
  }

  const retrievedAt = new Date().toISOString();
  const liveResult = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Identity & Identity Verification',
    sourceUrl: 'https://example.gov/public-record/123',
    content: 'Jane Example appears in this official public record for Sioux Falls, South Dakota with a verified filing.',
    confidence: 0.9,
    retrievedAt,
    durationMs: 120,
    transport: 'direct-http',
    httpStatus: 200,
  });
  let simulatedRejected = false;
  try {
    createPantheonSourceResult({
      crawler: 'startrek',
      sourceUrl: 'https://example.gov/simulation',
      content: 'Jane Example synthetic simulated mirrored test-mode output for Sioux Falls, South Dakota.',
      confidence: 0.9,
      retrievedAt,
      metadata: { simulated: true },
    });
  } catch {
    simulatedRejected = true;
  }
  if (!simulatedRejected) throw new Error('simulated source-result contract was not rejected');

  const attributableAudit = {
    crawler: 'startrek',
    status: 'completed_no_evidence',
    attempts: 1,
    targets: 1,
    sourceOutcomes: [{
      sourceUrl: 'https://example.gov/public-record/123',
      status: 'completed_no_evidence',
      retrievedAt,
      durationMs: 120,
    }],
  };
  if (!isLivePantheonCrawlerAudit(attributableAudit) || isLivePantheonCrawlerAudit({ ...attributableAudit, sourceOutcomes: [] })) {
    throw new Error('attributable crawler-result contract failed');
  }
  const zeroWork = assessPantheonCategoryOutcome({
    label: 'Identity & Identity Verification',
    targetCount: 0,
    expectedCapabilities: ['startrek'],
    crawlerAudit: [],
    urlLedger: [],
    requiredWorkCount: 1,
    successfulWorkCount: 0,
  });
  if (zeroWork.state === 'completed') throw new Error('zero-work category was incorrectly completed');
  const incompleteQuota = assessPantheonCategoryOutcome({
    label: 'Identity & Identity Verification',
    targetCount: 1,
    expectedCapabilities: ['startrek'],
    crawlerAudit: [attributableAudit],
    urlLedger: [{ state: 'no_evidence', attempts: 1, startedAt: retrievedAt, completedAt: retrievedAt, result: { status: 200 } }],
    requiredWorkCount: 2,
    successfulWorkCount: 1,
  });
  if (incompleteQuota.state !== 'partial') throw new Error('incomplete live-work quota was incorrectly completed');
  const incompleteInvestigation = assessPantheonInvestigation(PANTHEON_REPORT_CATEGORIES.slice(0, 29).map((category, index) => ({
    index,
    label: category.label,
    completionState: 'completed' as const,
  })));
  if (incompleteInvestigation.releaseEligible || incompleteInvestigation.state !== 'partial') {
    throw new Error('investigation missing one of 30 categories was incorrectly release eligible');
  }
  const completeInvestigation = { ...incompleteInvestigation, releaseEligible: true, state: 'completed' as const };
  const emptyRelease = assessPantheonReportRelease({
    investigation: completeInvestigation,
    categories: [{ evidenceCount: 0, urlLedger: [{ url: 'https://example.gov/empty', state: 'no_evidence' }] }],
  });
  if (emptyRelease.eligible || emptyRelease.blocker !== 'no_accepted_evidence') {
    throw new Error('zero-evidence investigation was incorrectly made downloadable');
  }
  const releasable = assessPantheonReportRelease({
    investigation: completeInvestigation,
    categories: [{ evidenceCount: 1, urlLedger: [{ url: 'https://example.gov/public-record/123', state: 'accepted' }] }],
  });
  if (!releasable.eligible || releasable.distinctAcceptedSourceCount !== 1) {
    throw new Error('accepted evidence and source provenance did not satisfy the report release gate');
  }

  const processed = processPantheonEvidence([
    liveResult,
    { ...liveResult, metadata: { simulated: true } },
  ], submission.name, submission.location);
  if (processed.accepted.length !== 1 || processed.rejected.length !== 1 ||
      processed.rejected[0].reason !== 'simulation_or_test_output') {
    throw new Error('verified-live evidence gate failed');
  }
  requireVerifiedPantheonEvidence(processed.accepted);

  const authorityNameOnly = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Identity & Identity Verification',
    sourceUrl: 'https://example.gov/directory/general',
    content: 'Jane Example appears on this general public page alongside many other people and general information.',
    confidence: 0.99,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const authorityOnlyResult = processPantheonEvidence([authorityNameOnly], submission.name, submission.location);
  if (authorityOnlyResult.accepted.length || authorityOnlyResult.rejected[0]?.reason !== 'subject_mismatch') {
    throw new Error('authoritative-domain/name-only false positive was accepted');
  }

  const genericLocationOverlap = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'News & Media Mentions',
    sourceUrl: 'https://news.example.org/article/general',
    content: 'Jane Example appeared in a new statewide announcement containing only general public information.',
    confidence: 0.9,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const genericLocationResult = processPantheonEvidence([genericLocationOverlap], submission.name, 'New York, NY');
  if (genericLocationResult.accepted.length || genericLocationResult.rejected[0]?.reason !== 'subject_mismatch') {
    throw new Error('one generic location token was accepted as an identity correlate');
  }

  const diagnosticPage = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Internet & Web Footprint',
    sourceUrl: 'https://example.org/security-check',
    content: 'Jane Example Sioux Falls South Dakota. Sign in to continue. Security check and gateway diagnostics.',
    confidence: 0.9,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const diagnosticResult = processPantheonEvidence([diagnosticPage], submission.name, submission.location);
  if (diagnosticResult.accepted.length || diagnosticResult.rejected[0]?.reason !== 'diagnostic_or_block_page') {
    throw new Error('raw diagnostic/block-page content crossed the evidence gate');
  }

  const guardedFuzzyIdentity = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Identity & Identity Verification',
    sourceUrl: 'https://records.example.gov/person/jane-exampel',
    content: 'Jane Exampel is a resident of Sioux Falls, South Dakota. This public resident record includes an address.',
    confidence: 0.9,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const guardedFuzzyResult = processPantheonEvidence([guardedFuzzyIdentity], submission.name, submission.location);
  if (guardedFuzzyResult.accepted.length !== 1 || !guardedFuzzyResult.accepted[0].metadata?.entityMatch) {
    throw new Error('guarded fuzzy identity match with an independent location correlate was rejected');
  }
  const uncorroboratedFuzzyResult = processPantheonEvidence([guardedFuzzyIdentity], submission.name, 'Portland, Oregon');
  if (uncorroboratedFuzzyResult.accepted.length !== 0) {
    throw new Error('fuzzy name similarity without an independent correlate crossed the evidence gate');
  }

  const phoneContent = 'Jane Example is a resident of Sioux Falls, South Dakota. Phone: (605) 555-1212. This directory entry identifies the listed resident.';
  const phoneEvidence = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Phone Numbers',
    sourceUrl: 'https://directory.example.org/people/jane-example',
    content: phoneContent,
    confidence: 0.86,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const typedClaimResult = processPantheonEvidence([phoneEvidence], submission.name, submission.location);
  const typedClaim = typedClaimResult.accepted[0]?.metadata?.categoryClaim as { claimType?: string } | undefined;
  if (typedClaimResult.accepted.length !== 1 || typedClaim?.claimType !== 'phone_number' ||
      !typedClaimResult.accepted[0].metadata?.citationId || !typedClaimResult.accepted[0].metadata?.evidenceRank) {
    throw new Error('typed category claim, stable citation, or deterministic rank metadata is missing');
  }

  const sameEvidenceLater = createPantheonSourceResult({
    crawler: 'birdofprey',
    capabilityId: 'birdofprey',
    categoryLabel: 'Phone Numbers',
    sourceUrl: phoneEvidence.sourceUrl,
    content: phoneContent,
    confidence: 0.86,
    retrievedAt: new Date(Date.parse(retrievedAt) + 60_000).toISOString(),
    durationMs: 90,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const laterClaimResult = processPantheonEvidence([sameEvidenceLater], submission.name, submission.location);
  if (typedClaimResult.accepted[0].metadata?.citationId !== laterClaimResult.accepted[0]?.metadata?.citationId) {
    throw new Error('citation identity changed with crawler or retrieval time');
  }

  const categorySibling = createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Internet & Web Footprint',
    sourceUrl: phoneEvidence.sourceUrl,
    content: phoneContent,
    confidence: 0.86,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
  });
  const categoryAwareResult = processPantheonEvidence([phoneEvidence, categorySibling], submission.name, submission.location);
  if (dedupePantheonEvidence(categoryAwareResult.accepted).length !== 2) {
    throw new Error('category-aware dedupe collapsed distinct category evidence');
  }

  const conflictingDob = (host: string, value: string) => createPantheonSourceResult({
    crawler: 'startrek',
    capabilityId: 'startrek',
    categoryLabel: 'Identity & Identity Verification',
    sourceUrl: `https://${host}/record/jane-example`,
    content: `Jane Example, resident of Sioux Falls, South Dakota. Date of birth: ${value}. Public identity record.`,
    confidence: 0.9,
    retrievedAt,
    durationMs: 80,
    transport: 'direct-http',
    httpStatus: 200,
    metadata: {
      claimType: 'date_of_birth',
      claimKey: 'jane-example:date-of-birth',
      claimValue: value,
      claimExclusive: true,
    },
  });
  const unresolvedConflict = processPantheonEvidence([
    conflictingDob('records-a.example.org', '01/02/1985'),
    conflictingDob('records-b.example.org', '01/02/1986'),
  ], submission.name, submission.location);
  if (unresolvedConflict.accepted.length !== 0 ||
      unresolvedConflict.rejected.filter(item => item.reason === 'conflicting_evidence').length !== 2) {
    throw new Error('unresolved singular-fact conflict produced a false-positive winner');
  }

  const categoryOutcomes = PANTHEON_REPORT_CATEGORIES.map((category, index) => ({
    index,
    label: category.label,
    completionState: index === 29 ? 'partial' : 'completed',
    completionReason: index === 29 ? 'One capability timed out.' : 'Verified live-source work completed.',
    targetCount: 1,
    evidenceCount: index === 0 ? 1 : 0,
    urlsAttempted: 1,
    urlsSuccessful: index === 29 ? 0 : 1,
    urlsFailed: index === 29 ? 1 : 0,
    requiredWorkCount: 1,
    successfulWorkCount: index === 29 ? 0 : 1,
    crawlersUsed: index === 0 ? ['startrek'] : [],
    evidenceRejected: 0,
    findings: index === 0 ? [processed.accepted[0].content] : [],
  }));

  const pdf = await generatePantheonBackgroundReportPdf({
    reportId: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date(),
    completedAt: new Date(),
    job: { investigationStatus: 'partial', searchDepth: 2 },
    categoryOutcomes,
    report: {
      identitySummary: { name: submission.name, verificationStatus: 'Verified live-source evidence only' },
      summary: 'Partial report with one exact omission.',
      confidenceScore: 0.8,
      reportCompleteness: 'partial',
      coverageGaps: [{
        category: PANTHEON_REPORT_CATEGORIES[29].label,
        state: 'partial',
        reason: 'One capability timed out.',
        pendingUrls: 1,
        missingCapabilities: ['lich'],
      }],
      sources: [{
        name: 'Identity & Identity Verification — startrek',
        data: {
          citationId: processed.accepted[0].evidenceId,
          evidenceId: processed.accepted[0].evidenceId,
          url: processed.accepted[0].sourceUrl,
          contentHash: processed.accepted[0].contentHash,
          provenance: processed.accepted[0].provenance,
          finding: processed.accepted[0].content,
        },
        confidence: processed.accepted[0].confidence,
        timestamp: new Date(processed.accepted[0].retrievedAt),
      }],
      investigationIntelligence: {
        manualReview: Array.from({ length: 500 }, (_, index) => ({
          category: 'fixture',
          reason: `Internal diagnostic ${index}`,
          sourceUrl: `https://diagnostic.example.org/${index}`,
        })),
        searchScope: [{
          category: 'fixture',
          jurisdictions: ['US-SD'],
          attemptedUrls: Array.from({ length: 2_000 }, (_, index) => `https://attempt.example.org/${index}`),
          successfulUrls: [],
          failedUrls: Array.from({ length: 2_000 }, (_, index) => ({
            url: `https://failed.example.org/${index}`,
            reason: 'fixture failure',
          })),
          negativeResult: 'No verified subject-specific record was accepted.',
        }],
      },
    },
  });
  const verification = verifyPantheonPdfBuffer(pdf, 2);
  if (!verification.verified || verification.pageCount < 2 || verification.sha256.length !== 64) {
    throw new Error('PDF render/layout verification failed');
  }
  if (verification.pageCount > 25 || pdf.length > 750_000) {
    throw new Error('internal URL/audit volume leaked into the printable customer PDF');
  }

  const reportId = '11111111-1111-4111-8111-111111111111';
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'pantheon-pdf-artifact-'));
  const environmentKeys = [
    'NODE_ENV',
    'PANTHEON_REPORT_FALLBACK_DIR',
    'RAILWAY_VOLUME_MOUNT_PATH',
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LEGALWHAT_EDGE_AUTH_SECRET',
    'SESSION_SECRET',
    'DATABASE_URL',
    'SUPABASE_DATABASE_URL',
  ] as const;
  const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  let reportStoreLoaded = false;
  try {
    process.env.NODE_ENV = 'test';
    process.env.PANTHEON_REPORT_FALLBACK_DIR = temporaryDirectory;
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.LEGALWHAT_EDGE_AUTH_SECRET;
    process.env.SESSION_SECRET = 'pantheon-pdf-test-session-secret-at-least-32-characters';
    process.env.DATABASE_URL = 'postgresql://pantheon:testing@127.0.0.1:1/pantheon_test';
    delete process.env.SUPABASE_DATABASE_URL;
    const {
      persistPantheonPdfArtifact,
      readPantheonPdfArtifact,
    } = await import('../server/services/pantheon/PantheonReportStore');
    reportStoreLoaded = true;

    const artifact = await persistPantheonPdfArtifact(reportId, pdf);
    if (!artifact.persistence.local.stored
      || artifact.persistence.local.durable
      || artifact.persistence.remote.configured
      || artifact.persistence.durable
      || artifact.persistence.local.mode !== '0600'
      || artifact.sha256 !== verification.sha256) {
      throw new Error('PDF persistence metadata was not truthful for production ephemeral storage');
    }
    const artifactPath = path.join(temporaryDirectory, `${reportId}.pdf`);
    if (((await stat(artifactPath)).mode & 0o777) !== 0o600) {
      throw new Error('PDF artifact permissions were not restricted to mode 0600');
    }
    const restored = await readPantheonPdfArtifact(reportId, verification.sha256);
    if (!restored?.equals(pdf)) throw new Error('verified PDF artifact could not be restored byte-for-byte');

    await writeFile(artifactPath, Buffer.from('corrupt PDF artifact'), { mode: 0o600 });
    if (await readPantheonPdfArtifact(reportId, verification.sha256)) {
      throw new Error('corrupt PDF artifact was accepted instead of requiring regeneration');
    }
    const repairedArtifact = await persistPantheonPdfArtifact(reportId, pdf);
    const repaired = await readPantheonPdfArtifact(reportId, repairedArtifact.sha256);
    if (!repaired?.equals(pdf)) throw new Error('regenerated PDF artifact could not be safely repersisted');
  } finally {
    if (reportStoreLoaded) {
      const { coordinationPool, pool } = await import('../server/db');
      await Promise.allSettled([pool.end(), coordinationPool.end()]);
    }
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log('Pantheon end-to-end coverage, provenance, evidence, and PDF layout verification passed.');
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
