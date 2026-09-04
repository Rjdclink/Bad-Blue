import assert from 'node:assert/strict';
import { evaluateNixGenRobustness } from '../../server/services/cryptocrawl/optimization/nix-gen/robust-uncertainty.js';
import type { NixGenStrategyBid } from '../../server/services/cryptocrawl/optimization/nix-gen/types.js';

const NOW = 4_000_000;

function bid(netProfitUsd = 5): NixGenStrategyBid {
  return {
    bidId: 'robust-test',
    opportunityId: 'opp-robust-test',
    strategyId: 'verification',
    strategyClass: 'cex_arbitrage',
    observedAt: NOW - 10,
    expiresAt: NOW + 1_000,
    economics: {
      netProfitUsd,
      notionalUsd: 100,
      netBps: 50,
      measuredAt: NOW - 10,
      authority: 'verification:canonical_fixture',
    },
    execution: {
      eligible: true,
      executable: true,
      settlementCapable: true,
      authoritativePath: 'verification:existing_authoritative_path',
    },
    resources: [],
  };
}

const components = [
  { label: 'slippage-envelope', maxAdverseUsd: 2, measuredAt: NOW - 5, validUntil: NOW + 500, authority: 'verification:slippage' },
  { label: 'latency-envelope', maxAdverseUsd: 1, measuredAt: NOW - 5, validUntil: NOW + 500, authority: 'verification:latency' },
];

function verifyFractionalBudgetAndCanonicalImmutability(): void {
  const candidate = bid(5);
  const before = JSON.stringify(candidate);
  const snapshot = evaluateNixGenRobustness({ bid: candidate, components, uncertaintyBudget: 1.5, now: NOW });
  assert.equal(snapshot.reserveUsd, 2.5);
  assert.equal(snapshot.robustAdvisoryValueUsd, 2.5);
  assert.equal(snapshot.canonicalNetProfitUsd, 5);
  assert.equal(snapshot.executionAuthority, false);
  assert.equal(snapshot.canonicalEconomicsAuthority, false);
  assert.equal(snapshot.filtersCanonicalCandidates, false);
  assert.equal(JSON.stringify(candidate), before, 'robustness diagnostic must not mutate the canonical bid');
}

function verifyBudgetMonotonicity(): void {
  const candidate = bid(5);
  const low = evaluateNixGenRobustness({ bid: candidate, components, uncertaintyBudget: 0.5, now: NOW });
  const high = evaluateNixGenRobustness({ bid: candidate, components, uncertaintyBudget: 2, now: NOW });
  assert.ok((high.reserveUsd ?? -1) >= (low.reserveUsd ?? Infinity));
  assert.ok((high.robustAdvisoryValueUsd ?? Infinity) <= (low.robustAdvisoryValueUsd ?? -Infinity));
}

function verifyUnknownEvidenceStaysUnknown(): void {
  const candidate = bid(5);
  const none = evaluateNixGenRobustness({ bid: candidate, components: [], uncertaintyBudget: 1, now: NOW });
  assert.equal(none.completeEvidence, false);
  assert.equal(none.reserveUsd, null);
  assert.equal(none.robustAdvisoryValueUsd, null);
  assert.ok(none.invalidEvidence.includes('missing_uncertainty_evidence'));

  const expired = evaluateNixGenRobustness({
    bid: candidate,
    components: [{ ...components[0], validUntil: NOW }],
    uncertaintyBudget: 1,
    now: NOW,
  });
  assert.equal(expired.completeEvidence, false);
  assert.equal(expired.reserveUsd, null);
  assert.ok(expired.invalidEvidence.some(reason => reason.startsWith('expired_evidence:')));
}

function verifyInvalidBudgetCannotBecomeZeroRisk(): void {
  const candidate = bid(5);
  const invalid = evaluateNixGenRobustness({ bid: candidate, components, uncertaintyBudget: Number.NaN, now: NOW });
  assert.equal(invalid.completeEvidence, false);
  assert.equal(invalid.uncertaintyBudget, null);
  assert.equal(invalid.reserveUsd, null);
  assert.equal(invalid.robustAdvisoryValueUsd, null);
  assert.ok(invalid.invalidEvidence.includes('invalid_uncertainty_budget'));
}

function verifyNegativeAdvisoryValueNeverCreatesVeto(): void {
  const candidate = bid(1);
  const snapshot = evaluateNixGenRobustness({ bid: candidate, components, uncertaintyBudget: 2, now: NOW });
  assert.ok((snapshot.robustAdvisoryValueUsd ?? 0) < 0);
  assert.equal(candidate.execution.eligible, true);
  assert.equal(candidate.execution.executable, true);
  assert.equal(snapshot.filtersCanonicalCandidates, false);
}

verifyFractionalBudgetAndCanonicalImmutability();
verifyBudgetMonotonicity();
verifyUnknownEvidenceStaysUnknown();
verifyInvalidBudgetCannotBecomeZeroRisk();
verifyNegativeAdvisoryValueNeverCreatesVeto();
console.log('NIX-GEN ROBUSTNESS ADVISORY BEHAVIOR VERIFIED');
