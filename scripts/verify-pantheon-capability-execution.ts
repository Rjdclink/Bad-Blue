import assert from 'node:assert/strict';
import {
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  PANTHEON_REPORT_CATEGORY_LABELS,
  buildPantheonCapabilityWorkLedger,
  getPantheonCategoryCapabilities,
  isPantheonExecutableWorkSchedulable,
  type PantheonCapabilityId,
  type PantheonExecutableWorkUnit,
  type PantheonTransport,
} from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';
import {
  assessPantheonCapabilityCoverage,
  finalizePantheonCategoryCapabilityOutcomes,
  type PantheonCapabilityHealth,
} from '../server/services/pantheon/PantheonCapabilityRuntime';
import { BaseRazor } from '../server/services/pantheon/razors/BaseRazor';
import { RazorType } from '../server/services/pantheon/razors/types';

const capabilityIds = Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[];
assert.equal(capabilityIds.length, 53, 'the production capability union must contain all 53 functions');

const transports: PantheonTransport[] = [
  'direct-http',
  'browser',
  'search-provider',
  'specialized-adapter',
  'archive',
];
const sources = transports.map((transport, index) => ({
  sourceUrl: `https://public.example.test/source-${index}`,
  transport,
}));

const courtWork = buildPantheonCapabilityWorkLedger({
  investigationId: 'behavioral-check',
  categoryLabel: 'Court Records',
  sources,
});
assert.equal(courtWork.length, 53, 'one persisted work row is required for every capability');
assert.equal(new Set(courtWork.map(unit => unit.capabilityId)).size, 53, 'work rows must be capability-unique');

const courtCapabilities = new Set(getPantheonCategoryCapabilities('Court Records'));
for (const unit of courtWork) {
  if (!courtCapabilities.has(unit.capabilityId)) {
    assert.equal(unit.state, 'not_applicable');
    assert.equal(unit.applicable, false);
    assert.match(unit.reason || '', /not permitted/i);
    continue;
  }
  assert.equal(unit.applicable, true);
  assert.equal(unit.state, 'pending');
  assert.ok(unit.sourceUrl, `${unit.capabilityId} must receive a source`);
  assert.ok(unit.transport, `${unit.capabilityId} must receive a transport`);
  assert.ok(
    PANTHEON_CRAWLER_CAPABILITY_MATRIX[unit.capabilityId].transports.includes(unit.transport!),
    `${unit.capabilityId} must receive a compatible transport`,
  );
}

for (const capabilityId of PANTHEON_PORTABLE_CAPABILITY_IDS) {
  const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId];
  assert.equal(descriptor.executionMode, 'credential-free-equivalent');
  assert.equal(descriptor.reportEvidenceEligible, false);
  assert.match(descriptor.replacementDisclosure || '', /live|public|local|deterministic|internal|credential/i);
}

const previous = courtWork.map(unit => ({ ...unit, attemptedSourceUrls: [...unit.attemptedSourceUrls] }));
const completed = previous.find(unit => unit.state === 'pending')!;
completed.state = 'completed';
completed.attempts = 1;
completed.outcome = 'completed_no_evidence';
const interrupted = previous.find(unit => unit.state === 'pending' && unit.capabilityId !== completed.capabilityId)!;
interrupted.state = 'running';
interrupted.attempts = 1;
const failed = previous.find(unit =>
  unit.state === 'pending'
    && unit.capabilityId !== completed.capabilityId
    && unit.capabilityId !== interrupted.capabilityId
)!;
failed.state = 'failed';
failed.attempts = 1;
failed.reason = 'route-local failure';

const resumed = buildPantheonCapabilityWorkLedger({
  investigationId: 'behavioral-check',
  categoryLabel: 'Court Records',
  sources,
  previous,
});
assert.equal(resumed.find(unit => unit.capabilityId === completed.capabilityId)?.state, 'completed');
assert.equal(resumed.find(unit => unit.capabilityId === interrupted.capabilityId)?.state, 'retryable');
assert.equal(resumed.find(unit => unit.capabilityId === failed.capabilityId)?.state, 'retryable');
assert.deepEqual(
  ['pending', 'retryable'].filter(state => isPantheonExecutableWorkSchedulable({ state } as PantheonExecutableWorkUnit)),
  ['pending', 'retryable'],
);
for (const state of ['running', 'completed', 'failed', 'timed_out', 'unavailable', 'not_applicable'] as const) {
  assert.equal(isPantheonExecutableWorkSchedulable({ state }), false, `${state} must not be assigned on resume`);
}

const healthy: PantheonCapabilityHealth[] = capabilityIds.map(capabilityId => ({
  capabilityId,
  status: 'healthy',
  checkedAt: new Date(0).toISOString(),
  durationMs: 1,
  reason: 'behavioral verification',
}));
const fallbackHealth = healthy.map(item => item.capabilityId === 'startrek'
  ? { ...item, status: 'unavailable' as const, fallbackCapabilityId: 'blizzard' as const }
  : item);
const normalBlizzardAudit = [{
  crawler: 'blizzard',
  status: 'completed_no_evidence',
  evidenceCount: 0,
  attempts: 1,
  targets: 1,
  route: 'primary' as const,
}];
const withoutLinkedFallback = finalizePantheonCategoryCapabilityOutcomes({
  categoryLabel: 'Identity & Identity Verification',
  health: fallbackHealth,
  crawlerAudit: normalBlizzardAudit,
});
assert.equal(withoutLinkedFallback.find(item => item.capabilityId === 'startrek')?.fallbackExecuted, false);

const withLinkedFallback = finalizePantheonCategoryCapabilityOutcomes({
  categoryLabel: 'Identity & Identity Verification',
  health: fallbackHealth,
  crawlerAudit: [{ ...normalBlizzardAudit[0], route: 'fallback' as const, fallbackFor: 'startrek' }],
});
assert.equal(withLinkedFallback.find(item => item.capabilityId === 'startrek')?.fallbackExecuted, true);

const categoryOutcomes = PANTHEON_REPORT_CATEGORY_LABELS.map(categoryLabel => {
  const permitted = getPantheonCategoryCapabilities(categoryLabel);
  const crawlerAudit = permitted.map(crawler => ({
    crawler,
    status: 'completed_no_evidence',
    evidenceCount: 0,
    attempts: 1,
    targets: 1,
  }));
  const capabilityOutcomes = finalizePantheonCategoryCapabilityOutcomes({
    categoryLabel,
    health: healthy,
    crawlerAudit,
  });
  for (const outcome of capabilityOutcomes.filter(item => !item.applicable)) {
    assert.equal(outcome.status, 'not_applicable');
    assert.ok(outcome.reason, `${outcome.capabilityId} requires a persisted not_applicable reason`);
  }
  return { capabilityOutcomes };
});
const coverage = assessPantheonCapabilityCoverage(categoryOutcomes);
assert.equal(coverage.eligible, true);
assert.equal(coverage.executedCapabilities.length, 53);
assert.deepEqual(coverage.missingCapabilities, []);
assert.deepEqual(coverage.undisclosedCapabilities, []);

class TimeoutRazor extends BaseRazor {
  readonly type = RazorType.IDENTITY;
  readonly patterns: RegExp[] = [];
  async extract(): Promise<Record<string, unknown>> {
    return new Promise(() => undefined);
  }
}
const timedOut = await new TimeoutRazor().run('<main>live</main>', 'https://public.example.test', 5);
assert.equal(timedOut.outcome, 'timed_out');
assert.match(timedOut.error || '', /timeout/i);

console.log('Pantheon capability execution behavioral verification passed.');
