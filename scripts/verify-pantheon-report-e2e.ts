import {
  generatePantheonBackgroundReportPdf,
  verifyPantheonPdfBuffer,
} from '../server/services/pantheon/PantheonBackgroundReportPdf';
import { createPantheonSourceResult } from '../server/services/pantheon/PantheonSourceResult';
import {
  processPantheonEvidence,
  requireVerifiedPantheonEvidence,
} from '../server/services/pantheon/PantheonEvidencePipeline';
import {
  initializePantheonCategoryPlans,
  PANTHEON_REPORT_CATEGORIES,
} from '../server/services/pantheon/PantheonCategoryWorkflow';
import { validatePantheonJobSubmission } from '../server/services/pantheon/PantheonJobSubmission';

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

  const processed = processPantheonEvidence([liveResult], submission.name, submission.location);
  if (processed.accepted.length !== 1 || processed.rejected.length !== 0) {
    throw new Error('verified-live evidence gate failed');
  }
  requireVerifiedPantheonEvidence(processed.accepted);

  const categoryOutcomes = PANTHEON_REPORT_CATEGORIES.map((category, index) => ({
    index,
    label: category.label,
    completionState: index === 29 ? 'partial' : 'completed',
    completionReason: index === 29 ? 'One capability timed out.' : 'Verified live-source work completed.',
    targetCount: 1,
    evidenceCount: index === 0 ? 1 : 0,
    urlsAttempted: 1,
    urlsSuccessful: index === 0 ? 1 : 0,
    urlsFailed: index === 0 ? 0 : 1,
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
    },
  });
  const verification = verifyPantheonPdfBuffer(pdf, 2);
  if (!verification.verified || verification.pageCount < 2 || verification.sha256.length !== 64) {
    throw new Error('PDF render/layout verification failed');
  }
  console.log('Pantheon end-to-end coverage, provenance, evidence, and PDF layout verification passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
