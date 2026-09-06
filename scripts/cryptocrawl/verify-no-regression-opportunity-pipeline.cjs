// Canonical opportunity-pipeline no-regression composition.
//
// This file intentionally owns no duplicate source assertions. Focused invariant
// verifiers own their domains and are composed here so CI has one current entry
// point instead of multiple stale copies of pipeline truth.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-cex-authoritative-batch-handoff.cjs');
require('./verify-single-profit-admission-authority.cjs');
require('./verify-bps-rebate-refund-truth.cjs');
require('./verify-cex-fee-recovery-completion.cjs');
require('./verify-stage-soft-gate-retirement.cjs');
require('./verify-dex-atomic-profit-path.cjs');
require('./verify-aave-liquidation-profit-integrity.cjs');
require('./verify-topology-execution-integrity.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');
require('./verify-canonical-execution-family-completion.cjs');
require('./verify-resource-bps-authority.cjs');
require('./verify-payout-recipient-truth.cjs');

console.log('[no-regression-opportunity-pipeline] PASS: canonical focused invariant composition; one strictly-positive all-in-net-profit admission authority; no duplicate minimum-profit gate');
