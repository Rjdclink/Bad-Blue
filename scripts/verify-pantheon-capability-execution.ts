import assert from 'node:assert/strict';
import {
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  buildPantheonCapabilityWorkLedger,
  getPantheonCategoryCapabilities,
  isPantheonCapabilitySourceCompatible,
  isPantheonExecutableWorkSchedulable,
  type PantheonCapabilityId,
  type PantheonExecutableWorkUnit,
} from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';
import { finalizePantheonCategoryCapabilityOutcomes, type PantheonCapabilityHealth } from '../server/services/pantheon/PantheonCapabilityRuntime';
import { runPortablePantheonCapabilities } from '../server/services/pantheon/PantheonPortableCapabilityExecutor';
import { BaseRazor } from '../server/services/pantheon/razors/BaseRazor';
import { RazorType } from '../server/services/pantheon/razors/types';

const capabilityIds = Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[];
assert.equal(capabilityIds.length, 53, 'the production capability union must contain all 53 functions');

const sources = [
  {
    sourceUrl: 'https://www.bing.com/search?q=Jane+Example+court',
    transport: 'search-provider' as const,
    registryCategory: 'courts' as const,
    sourceKind: 'search' as const,
    authority: 'discovery' as const,
    jurisdiction: 'US',
    workType: 'discovery-search' as const,
    subjectScoped: true,
  },
  {
    sourceUrl: 'https://www.courtlistener.com/docket/123/jane-example/',
    transport: 'direct-http' as const,
    registryCategory: 'courts' as const,
    sourceKind: 'public-page' as const,
    authority: 'secondary' as const,
    jurisdiction: 'US',
    workType: 'candidate-validation' as const,
    subjectScoped: true,
  },
  {
    sourceUrl: 'https://judiciary.example.gov/case-search/jane-example',
    transport: 'direct-http' as const,
    registryCategory: 'courts' as const,
    sourceKind: 'public-page' as const,
    authority: 'primary' as const,
    jurisdiction: 'US-OH',
    workType: 'candidate-validation' as const,
    subjectScoped: true,
  },
  {
    sourceUrl: 'https://examplecounty.gov/clerk/case/jane-example',
    transport: 'direct-http' as const,
    registryCategory: 'courts' as const,
    sourceKind: 'public-page' as const,
    authority: 'primary' as const,
    jurisdiction: 'US-OH',
    workType: 'candidate-validation' as const,
    subjectScoped: true,
  },
];

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
assert.equal(courtCapabilities.has('warrant-database'), false, 'warrant extraction must be restricted to warrant categories');
assert.equal(courtCapabilities.has('sex-offender-registry'), false, 'registry extraction must be restricted to its declared category');
assert.equal(
  getPantheonCategoryCapabilities('Social-Media Profiles').includes('social-media-scraper'),
  true,
  'social extraction must be routed to social source categories',
);
assert.equal(
  getPantheonCategoryCapabilities('Identity & Identity Verification').includes('social-media-scraper'),
  false,
  'social extraction must not be assigned to identity-only sources',
);
assert.equal(
  getPantheonCategoryCapabilities('Property & Real Estate').includes('beneficial'),
  false,
  'business ownership extraction must not be assigned to property-only sources',
);
assert.equal(
  getPantheonCategoryCapabilities('Incarceration & Corrections').includes('pacer'),
  false,
  'federal docket extraction must not be assigned to corrections-only sources',
);
assert.equal(
  getPantheonCategoryCapabilities('Warrants & Wanted-Person Records').includes('warrant-database'),
  true,
);
assert.equal(
  getPantheonCategoryCapabilities('Sex-Offender Registries').includes('sex-offender-registry'),
  true,
);
assert.equal(isPantheonCapabilitySourceCompatible('pacer', sources[0]), false);
assert.equal(isPantheonCapabilitySourceCompatible('pacer', sources[1]), true);
assert.equal(isPantheonCapabilitySourceCompatible('state-court', sources[2]), true);
assert.equal(isPantheonCapabilitySourceCompatible('county-court', sources[3]), true);

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
const resumedAfterConsumedSource = buildPantheonCapabilityWorkLedger({
  investigationId: 'behavioral-check',
  categoryLabel: 'Court Records',
  sources: sources.filter(source => source.sourceUrl !== completed.sourceUrl),
  previous,
});
assert.equal(
  resumedAfterConsumedSource.find(unit => unit.capabilityId === completed.capabilityId)?.state,
  'completed',
  'a source-compatible completed unit must remain terminal after its URL leaves the pending frontier',
);

const invalidLegacyCompletion = previous.map(unit => ({ ...unit, attemptedSourceUrls: [...unit.attemptedSourceUrls] }));
const invalidPacer = invalidLegacyCompletion.find(unit => unit.capabilityId === 'pacer')!;
Object.assign(invalidPacer, {
  state: 'completed',
  sourceUrl: sources[0].sourceUrl,
  transport: sources[0].transport,
  sourceRegistryCategory: sources[0].registryCategory,
  sourceKind: sources[0].sourceKind,
  sourceAuthority: sources[0].authority,
  sourceJurisdiction: sources[0].jurisdiction,
  workType: sources[0].workType,
  subjectScoped: true,
});
const repairedLegacyCompletion = buildPantheonCapabilityWorkLedger({
  investigationId: 'behavioral-check',
  categoryLabel: 'Court Records',
  sources,
  previous: invalidLegacyCompletion,
});
assert.equal(
  repairedLegacyCompletion.find(unit => unit.capabilityId === 'pacer')?.state,
  'pending',
  'a completed unit from a source-skill mismatch must be invalidated and reassigned',
);
assert.deepEqual(
  ['pending', 'retryable'].filter(state => isPantheonExecutableWorkSchedulable({ state } as PantheonExecutableWorkUnit)),
  ['pending', 'retryable'],
);
for (const state of ['running', 'completed', 'failed', 'timed_out', 'unavailable', 'not_applicable'] as const) {
  assert.equal(isPantheonExecutableWorkSchedulable({ state }), false, `${state} must not be assigned on resume`);
}

const rejectedRoute = await runPortablePantheonCapabilities({
  capabilityIds: ['pacer'],
  sourceUrl: sources[0].sourceUrl,
  content: '<main>Jane Example federal court docket</main>',
  subject: 'Jane Example',
  sourceContext: sources[0],
});
assert.equal(rejectedRoute[0].status, 'failed');
assert.match(rejectedRoute[0].error || '', /source-skill admission/i);

const acceptedRoute = await runPortablePantheonCapabilities({
  capabilityIds: ['pacer'],
  sourceUrl: sources[1].sourceUrl,
  content: '<main>Jane Example federal district court docket 123</main>',
  subject: 'Jane Example',
  sourceContext: sources[1],
});
assert.equal(acceptedRoute[0].status, 'completed_with_evidence');
assert.equal(acceptedRoute[0].capabilityOutput?.sourceCompatible, true);

const weakIdentityMatch = await runPortablePantheonCapabilities({
  capabilityIds: ['pacer'],
  sourceUrl: sources[1].sourceUrl,
  content: '<main>Jane Roe federal district court docket 987</main>',
  subject: 'Jane Example',
  sourceContext: sources[1],
});
assert.equal(weakIdentityMatch[0].status, 'completed_no_evidence');

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

const truthfulCourtOutcomes = finalizePantheonCategoryCapabilityOutcomes({
  categoryLabel: 'Court Records',
  health: healthy,
  crawlerAudit: acceptedRoute,
});
assert.equal(truthfulCourtOutcomes.find(item => item.capabilityId === 'pacer')?.status, 'completed_with_evidence');
assert.equal(truthfulCourtOutcomes.find(item => item.capabilityId === 'warrant-database')?.status, 'not_applicable');
assert.ok(
  truthfulCourtOutcomes.some(item => item.applicable && item.status === 'not_executed'),
  'unexecuted applicable capability work must stay visibly missing',
);

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
