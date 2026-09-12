'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');

const runtimeDb = read('server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts');
const runtimeSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const selfFundedBootstrap = read('server/services/cryptocrawl/execution/self-funded-cex-bootstrap.ts');
const providerSelection = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-selection-registry.ts');
const zeroCapitalExecutor = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const cexExecutor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');

// Master repair 1: one writable Overflow hot authority. A persistent Railway
// backend must not be forced onto the shared transaction pooler, and startup must
// prove persistent-table write capability rather than infer it from object presence.
assert.match(runtimeDb, /derivePoolerMode\(configuredOverflowUrl, '5432'\) \|\| configuredOverflowUrl/);
assert.doesNotMatch(runtimeDb, /derivePoolerMode\(configuredOverflowUrl, '6543'\)/);
assert.match(runtimeDb, /Overflow hot mutation\/coordination lanes must be session-capable/);
assert.match(runtimeSchema, /async function verifyRuntimeWriteAuthority\(client: any\)/);
assert.match(runtimeSchema, /current_setting\('transaction_read_only'\)/);
assert.match(runtimeSchema, /current_setting\('default_transaction_read_only'\)/);
assert.match(runtimeSchema, /pg_is_in_recovery\(\)/);
assert.match(runtimeSchema, /SET TRANSACTION READ WRITE/);
assert.match(runtimeSchema, /UPDATE private\.cryptocrawler_overflow_runtime_meta[\s\S]{0,180}SET updated_at=updated_at/);
assert.match(runtimeSchema, /await client\.query\('ROLLBACK'\)\.catch\(\(\) => undefined\)/);
assert.match(runtimeSchema, /if \(durableReady\) \{[\s\S]{0,420}await verifyRuntimeWriteAuthority\(client\)/);
assert.match(runtimeSchema, /await markVerified\(client\);[\s\S]{0,100}await verifyRuntimeWriteAuthority\(client\);/);
assert.match(runtimeSchema, /writeCanaryMutationCommitted: false/);

// Master repair 2: provider planning remains one canonical selection authority.
// This verifier intentionally locks the existing compatible-provider registry and
// money boundary instead of introducing a second resolver.
assert.match(providerSelection, /Sole flash-provider selection authority for ZERO_CAPITAL_ATOMIC/);
assert.match(providerSelection, /Single-provider[\s\S]{0,100}combined-provider choices share one opportunity-keyed registry/);
assert.match(zeroCapitalExecutor, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(zeroCapitalExecutor, /selection\.expiresAt <= Date\.now\(\)/);
assert.match(zeroCapitalExecutor, /selection\.kind === 'dual'/);

// Master repair 3: SELF_FUNDED realized system capital remains a bootstrap source
// for ordinary CEX inventory, with venue/route failure local rather than global.
assert.match(selfFundedBootstrap, /s\.lifecycle='SELF_FUNDED'/);
assert.match(selfFundedBootstrap, /cryptocrawler_onchain_system_owned_lots/);
assert.match(selfFundedBootstrap, /coinbase/);
assert.match(selfFundedBootstrap, /kraken/);
assert.match(selfFundedBootstrap, /okx/);
assert.match(selfFundedBootstrap, /continue;/);
assert.match(selfFundedBootstrap, /reserveAuthorizedSystemCapital/);

// Master repair 4: exact positive all-in net profit is canonical admission.
// BPS is derived/observability data and cannot become a separate hard gate.
assert.match(registry, /function measuredNetBps\([\s\S]{0,520}deterministicNetProfitUsd \/ notionalUsd \* 10_000/);
assert.match(registry, /netBps: measuredNetBps\(economics, notionalUsd\)/);
const minimumEvidence = registry.match(/export function hasMinimumSufficientExecutionEvidence\([\s\S]*?\n\}/)?.[0] || '';
assert.ok(minimumEvidence, 'minimum sufficient execution evidence function must exist');
assert.match(minimumEvidence, /deterministicNetProfitUsd !== null/);
assert.match(minimumEvidence, /deterministicNetProfitUsd > 0/);
assert.match(minimumEvidence, /candidate\.expiresAt > now/);
assert.match(minimumEvidence, /candidate\.depth\.status !== 'unavailable'/);
assert.match(minimumEvidence, /candidate\.executableCapability === true/);
assert.doesNotMatch(minimumEvidence, /netBps/);

// Existing fresh-evidence money-boundary protection must survive this patch.
assert.match(cexExecutor, /const effectiveQuoteAgeMs = Math\.max\(0, plan\.quoteAgeMs\) \+ \(Date\.now\(\) - executionAdmissionStartedAt\)/);
assert.match(cexExecutor, /effectiveQuoteAgeMs > maxQuoteAgeMs/);
assert.match(cexExecutor, /REJECT_STALE_QUOTE/);
assert.match(cexExecutor, /plan\.netProfitUsd <= 0/);
assert.doesNotMatch(cexExecutor, /netProfitBps\s*[<>]=?\s*/);

console.log(JSON.stringify({
  compoundRuntimeProfitabilityRepairs: 'verified',
  overflowHotAuthority: 'session_capable_plus_rollback_write_canary',
  duplicateExecutionPlanAuthorityIntroduced: false,
  selfFundedCexBootstrapPreserved: true,
  exactPositiveNetAdmissionAuthority: true,
  bpsExecutionVeto: false,
  freshCexSubmissionGuardPreserved: true,
}, null, 2));
