import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPantheonControlledQueryPlan, normalizePantheonStartingIdentifier, PANTHEON_IDENTIFIER_KINDS } from '../server/services/pantheon/PantheonQueryPlan';
import { parsePantheonDocument } from '../server/services/pantheon/PantheonDocumentIntelligence';
import { buildPantheonInvestigationIntelligence } from '../server/services/pantheon/PantheonInvestigationIntelligence';
import { buildPantheonCategoryTargets } from '../server/services/pantheon/PantheonSovereignSourceRegistry';
import { generatePantheonBackgroundReportPdf, verifyPantheonPdfBuffer } from '../server/services/pantheon/PantheonBackgroundReportPdf';

const identifierFixtures: Record<string, string> = {
  name: 'Taylor Example',
  phone: '+1 212 555 0100',
  email: 'taylor@example.com',
  username: '@taylor_example',
  address: '10 Main Street, Albany, NY',
  business: 'Example Holdings LLC',
  property: 'Parcel 123-456',
  vin: '1HGCM82633A004352',
};
for (const kind of PANTHEON_IDENTIFIER_KINDS) {
  const identifier = normalizePantheonStartingIdentifier({ kind, value: identifierFixtures[kind] });
  const plan = buildPantheonControlledQueryPlan({ primary: identifier, location: 'New York', searchDepth: 3 });
  assert.equal(plan.primary.kind, kind);
  assert.equal(plan.automaticIdentityMerge, false);
  assert.equal(plan.relationshipHopLimit, 3);
}

const parsed = await parsePantheonDocument({
  bytes: Buffer.from(JSON.stringify({ subject: 'Taylor Example', record: 'verified fixture' })),
  contentType: 'application/json',
  url: 'https://example.test/record.json',
});
assert.equal(parsed.parser, 'json');
assert.match(parsed.content, /Taylor Example/);

const snapshotDirectory = await mkdtemp(path.join(tmpdir(), 'pantheon-blueprint-'));
process.env.PANTHEON_RAW_SNAPSHOT_DIR = snapshotDirectory;
const { persistPantheonRawSnapshot } = await import('../server/services/pantheon/PantheonRawSnapshotStore');
const snapshotA = await persistPantheonRawSnapshot({ investigationId: 'fixture', bytes: Buffer.from('immutable source'), capturedAt: new Date().toISOString() });
const snapshotB = await persistPantheonRawSnapshot({ investigationId: 'fixture', bytes: Buffer.from('immutable source'), capturedAt: new Date().toISOString() });
assert.equal(snapshotA.storageKey, snapshotB.storageKey);
assert.equal(snapshotA.immutable, true);
assert.ok((await readFile(path.join(snapshotDirectory, snapshotA.storageKey))).length > 0);

const plan = buildPantheonControlledQueryPlan({
  primary: { kind: 'name', value: 'Taylor Example' },
  location: 'New York',
  searchDepth: 2,
});
const targets = buildPantheonCategoryTargets('identity', 'Taylor Example', 'New York', 8);
assert.ok(targets.length > 0);
assert.ok(targets.every(target => target.sourceKind && Number.isFinite(target.freshnessWeight) && Number.isFinite(target.expectedValue)));

const acceptedUrl = 'https://records.example.test/taylor';
const categoryOutcomes: any[] = [{
  index: 0,
  label: 'Identity & Identity Verification',
  evidenceCount: 1,
  reviewItems: [{ reason: 'weak_evidence', sourceUrl: 'https://lead.example.test/taylor', excerpt: 'Possible unverified connection' }],
  urlLedger: [
    { url: acceptedUrl, jurisdiction: 'US-NY', attempts: 1, state: 'accepted', evidenceIds: ['evidence-1'], result: { retrievedAt: new Date().toISOString() } },
    { url: 'https://failed.example.test/taylor', jurisdiction: 'US-NY', attempts: 1, state: 'dead', evidenceIds: [], failureReason: 'not_found' },
  ],
}];
const report: any = {
  identitySummary: { name: 'Taylor Example', verificationStatus: 'Verified fixture' },
  reportCompleteness: 'partial',
  coverageGaps: [{ category: 'Phone Numbers', state: 'pending', reason: 'fixture', pendingUrls: 1, missingCapabilities: ['startrek'] }],
  searchDepthUsed: 2,
  confidenceScore: 0.9,
  summary: 'Fixture summary',
  sources: [{
    name: 'Identity & Identity Verification — startrek',
    confidence: 0.9,
    timestamp: new Date(),
    data: {
      citationId: 'citation-1',
      evidenceId: 'evidence-1',
      url: acceptedUrl,
      contentHash: 'a'.repeat(64),
      finding: 'Taylor Example identity record',
      categoryClaim: { categoryLabel: 'Identity & Identity Verification', claimType: 'identity_record', claimKey: 'subject:identity', claimValue: 'Taylor Example', normalizedValue: 'taylor example' },
      provenance: { retrievedAt: new Date().toISOString(), transport: 'direct-http' },
    },
  }],
  categoryOutcomes,
};
const intelligence = buildPantheonInvestigationIntelligence({ report, categoryOutcomes: categoryOutcomes as any, queryPlan: plan });
assert.equal(intelligence.identityGraph.hopLimit, 2);
assert.equal(intelligence.verifiedFindings.length, 1);
assert.equal(intelligence.investigativeLeads.length, 1);
assert.deepEqual(intelligence.searchScope[0].jurisdictions, ['US-NY']);
assert.match(intelligence.negativeResultQualification, /does not prove/i);
report.investigationIntelligence = intelligence;

const pdf = await generatePantheonBackgroundReportPdf({ reportId: '11111111-1111-4111-8111-111111111111', report, categoryOutcomes, completedAt: new Date() });
const verified = verifyPantheonPdfBuffer(pdf, 2);
assert.equal(verified.metadataVerified, true);
assert.ok(verified.textObjectCount >= verified.pageCount);
assert.ok(verified.linkAnnotationCount >= 1);

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /poppler-utils/);
assert.match(dockerfile, /tesseract-ocr/);
const jobSource = await readFile(new URL('../server/services/pantheon/PantheonBackgroundReportJob.ts', import.meta.url), 'utf8');
assert.match(jobSource, /deadLetter/);
assert.match(jobSource, /recoveryAttempt/);
assert.match(jobSource, /persistPantheonSavedSearchSnapshot/);

await rm(snapshotDirectory, { recursive: true, force: true });
console.log('Pantheon retained blueprint items 1-66 behavioral verification passed.');
