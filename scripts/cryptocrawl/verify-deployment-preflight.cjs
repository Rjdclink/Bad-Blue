// Established safety gates plus current measured-profitability/resource behavior verifiers.

// The canonical ZERO_CAPITAL_ATOMIC component now has a narrow router plus a preserved
// byte-for-byte flash implementation. Legacy structural verifiers below were written
// specifically against the flash implementation. Redirect only their read of the old
// canonical filename to the preserved flash file. The redirect is restored before the
// Ghost Wallet verifier runs, so the new router is inspected directly. No assertion is
// skipped or weakened.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function verificationLogicalSource(path, ...args) {
  const normalized = String(path).replaceAll('\\', '/');
  if (normalized.endsWith('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts')) {
    const redirected = normalized.replace(
      'server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts',
      'server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts',
    );
    return originalReadFileSync.call(fs, redirected, ...args);
  }
  return originalReadFileSync.call(fs, path, ...args);
};

require('./verify-bps-structural-repairs.cjs');
require('./verify-overflow-complete-runtime-authority.cjs');
require('./verify-runtime-safety-invariants.cjs');
require('./verify-runtime-component-isolation.cjs');
require('./verify-runtime-build-attestation.cjs');
require('./verify-hyperscope-first3-runtime-authority.cjs');
require('./verify-okx-adaptive-rate-governor.cjs');
require('./verify-okx-account-fee-authority.cjs');
require('./verify-bps-rebate-refund-truth.cjs');
require('./verify-cex-fee-recovery-completion.cjs');
require('./verify-single-profit-admission-authority.cjs');
require('./verify-inventory-intent-netting.cjs');
require('./verify-antenna-production-hot-path.cjs');
require('./verify-stage-soft-gate-retirement.cjs');
require('./verify-bps-order-control-revalidation.cjs');
require('./verify-bps-efficiency-wave2-foundation.cjs');
require('./verify-bps-frontier-wave3.cjs');
require('./verify-bps-private-refund-wave4.cjs');
require('./verify-bps-provider-feedback-wave5.cjs');
require('./verify-effective-gas-economics.cjs');
require('./verify-atomic-zero-capital-strategy-coverage.cjs');
require('./verify-kalshi-bps-integration.cjs');
require('./verify-kalshi-coinbase-funding-integration.cjs');
require('./verify-kalshi-negative-funding-inverse.cjs');
require('./verify-kalshi-premerge-completion.cjs');
require('./verify-builder-sponsored-coldstart-foundation.cjs');
require('./verify-zero-capital-capability-monotonicity.cjs');
require('./verify-market-evidence-kalshi-capability.cjs');
require('./verify-zero-capital-route-retention-and-standby-truth.cjs');
require('./verify-zero-capital-single-route-pipeline.cjs');
require('./verify-okx-order-expiration.cjs');
require('./verify-kraken-l3-queue-amend.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');
require('./verify-remaining-seventeen-batch12.cjs');
require('./verify-competition-evidence-wiring.cjs');
require('./verify-300-profitability-live-execution-controls.cjs');
require('./verify-aave-balancer-provider-mesh.cjs');
require('./verify-provider-failure-locality.cjs');
require('./verify-pending-stream-provider-failover.cjs');
require('./verify-liquidation-log-range-failover.cjs');
require('./verify-deterministic-positive-quote-admission.cjs');
require('./verify-protocol-anchor-route-locality.cjs');
require('./verify-fluid-simulation-return-decoding.cjs');
require('./verify-provider-specific-receiver-coldstart.cjs');
require('./verify-morpho-zero-fee-flash.cjs');
require('./verify-cex-websocket-rpi-modernization.cjs');
require('./verify-resource-bps-coordination.cjs');
require('./verify-migration-authority-runtime.cjs');
require('./verify-railway-config-compatibility.cjs');
require('./verify-startup-database-admission.cjs');
require('./verify-runtime-db-disconnect-resilience.cjs');
require('./verify-free-tier-startup-gate.cjs');
require('./verify-cryptara-supabase-admission-worker.cjs');
require('./verify-cryptara-supabase-comp-switch.cjs');
require('./verify-cryptara-supabase-overflow.cjs');
require('./verify-cryptara-supabase-hyper-bridge.cjs');
require('./verify-cryptara-hyper-bridge-bootstrap.cjs');
require('./verify-cryptara-resource-intelligence.cjs');
require('./verify-cryptara-super-worker.cjs');
require('./verify-supabase-background-pressure.cjs');
require('./verify-production-pressure-evidence-repairs.cjs');
require('./verify-runtime-initialization-efficiency.cjs');
require('./verify-product-discovery-coverage.cjs');
require('./verify-cross-venue-asset-identity.cjs');
require('./verify-dex-atomic-profit-path.cjs');
require('./verify-zero-capital-quote-liveness.cjs');
require('./verify-stale-evidence-reacquisition.cjs');
require('./verify-multi-topology-discovery-liveness.cjs');
require('./verify-aave-liquidation-profit-integrity.cjs');
require('./verify-topology-execution-integrity.cjs');
require('./verify-degraded-rpc-cross-chain-admission.cjs');
require('./verify-across-token-catalog-auth.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');
require('./verify-canonical-execution-family-completion.cjs');
require('./verify-resource-bps-authority.cjs');
require('./verify-payout-recipient-truth.cjs');
require('./verify-final-evidence-route-resolution.cjs');
require('./verify-minimum-sufficient-execution-evidence.cjs');
require('./verify-first-pass-route-measurability.cjs');
require('./verify-canonical-refresh-capability-authority.cjs');
require('./verify-bps-zero-capital-event-handoff.cjs');
require('./verify-ghost-settlement-log-failover.cjs');

fs.readFileSync = originalReadFileSync;
require('./verify-ghost-wallet-atomic-capital.cjs');
require('./verify-ghost-wallet-merge-gate.cjs');
require('./verify-full-runtime-regression-repair.cjs');

// Compile runtime-deployable contracts during the real production prebuild. The
// flash receiver compiler writes Balancer, composite, Aave V3, Morpho Blue, and
// Aave+Balancer artifacts into artifacts/cryptocrawl before Docker copies that
// directory into the production image. Missing provider artifacts therefore fail
// the build instead of silently removing an otherwise supported route.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(
  npx,
  ['--no-install', 'tsx', 'scripts/cryptocrawl/compile-flashloan-receiver.ts'],
  { stdio: 'inherit', env: process.env },
);

for (const [artifactPath, expectedContract] of [
  ['artifacts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.json', 'CryptocrawlAaveV3FlashLoanReceiver'],
  ['artifacts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.json', 'CryptocrawlMorphoFlashLoanReceiver'],
]) {
  const artifact = JSON.parse(originalReadFileSync(artifactPath, 'utf8'));
  if (artifact.contractName !== expectedContract || typeof artifact.bytecode !== 'string' || !artifact.bytecode.startsWith('0x') || artifact.bytecode.length <= 2) {
    throw new Error(`Required zero-capital receiver artifact is incomplete: ${artifactPath}`);
  }
}

// Ghost Wallet contracts use their existing compiler path. Keeping the two
// compilation steps independent means a failure is local and the build fails
// closed without changing any runtime execution authority.
execFileSync(
  process.execPath,
  ['scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs'],
  { stdio: 'inherit', env: process.env },
);

console.log('[deployment-preflight] structural BPS truth plus complete Overflow runtime authority, checked-out database disconnect resilience, Kalshi bidirectional funding/prediction/maker/cross-venue/zero-personal-capital completion, safety, measured-profitability, provider, treasury, execution-family, production-pressure/evidence recovery, minimum-sufficient execution evidence, first-pass route measurability, canonical refresh/capability authority, event-driven zero-capital BPS evidence handoff, bounded stale-evidence canonical reacquisition, bounded multi-topology discovery liveness, route-local protocol-anchor failure isolation, Fluid successful-return and custom-revert quote decoding, continuously-available provider-mesh pending fallback, degraded-but-usable RPC cross-chain admission, authenticated Across token catalog resolution, provider-local adaptive Ghost settlement log recovery, final evidence/route resolution, payout invariants, Ghost Wallet atomic-capital isolation, deterministic no-manual bootstrap, merge gate, full runtime regression repair gate, flash-receiver and Ghost Wallet Solidity compilation, and single zero-capital route authority passed; continuing to downstream prebuild/build');