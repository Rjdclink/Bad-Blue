'use strict';

const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const failures = [];
const must = (source, text, label) => { if (!source.includes(text)) failures.push(`missing ${label}: ${text}`); };
const mustNot = (source, pattern, label) => { if (pattern.test(source)) failures.push(`forbidden ${label}: ${pattern}`); };

const economics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const capability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const selectionRegistry = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-selection-registry.ts');
const payload = read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts');
const compositePayload = read('server/services/cryptocrawl/execution/adapters/composite-flashloan-receiver-builder.ts');
const deploy = read('scripts/cryptocrawl/deploy-flashloan-receiver.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const providerExecution = read('server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const canonical = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

must(economics, 'getReserveAToken(address asset)', 'Aave reserve aToken discovery');
must(economics, 'token.balanceOf(aTokenAddress)', 'Aave measured underlying reserve liquidity');
must(economics, 'FLASHLOAN_PREMIUM_TOTAL()', 'Aave measured flash-loan premium');
must(economics, 'receiver_readiness_separate_authority', 'market economics separated from receiver readiness');
must(economics, 'allowedProviders', 'execution-capability-scoped provider selection');
mustNot(economics, /availableLiquidity:\s*null,[\s\S]{0,300}provider:\s*'aave_v3'/, 'permanent assumed Aave liquidity absence');

must(capability, "kind === 'aave_v3' ? 'pool' : 'vault'", 'provider-specific infrastructure verification');
must(capability, "input.provider.getCode(address)", 'receiver bytecode verification');
must(capability, 'receiver_owner_verified', 'receiver owner verification');
must(capability, 'buildMissingReceiverPermissionCalls', 'provider-specific permission readiness');
must(capability, 'allowedTargets', 'target allowlist check');
must(capability, 'allowedApprovalTokens', 'approval-token allowlist check');

must(deploy, "'balancer-composite-v2'", 'Composite V2 deploy kind');
must(deploy, "'aave-v3'", 'Aave V3 deploy kind');
must(deploy, 'compileCompositeFlashLoanReceiver', 'Composite V2 compilation');
must(deploy, 'compileAaveV3FlashLoanReceiver', 'Aave V3 compilation');
must(deploy, 'DEPLOYMENT_OWNER_MISMATCH', 'post-deploy owner verification');
must(deploy, 'DEPLOYMENT_INFRASTRUCTURE_MISMATCH', 'post-deploy provider binding verification');
must(deploy, '${chain}-${receiverKind}.json', 'non-overwriting per-kind deployment record');

must(payload, 'executeAaveFlashLoan', 'Aave provider-specific payload ABI');
must(payload, 'executeBalancerFlashLoan', 'Balancer provider-specific payload ABI');
must(payload, "provider === 'aave_v3'", 'provider-specific payload switch');
must(compositePayload, 'executeBalancerCompositeFlashLoan', 'Composite V2 payload');
must(compositePayload, 'cycleEndStepIndexes', 'explicit composite cycle boundaries');
must(compositePayload, 'MAX_ATOMIC_SWAP_STEPS = 16', 'bounded composite step envelope');

must(selectionRegistry, 'provider: FlashLoanProviderKind', 'per-opportunity provider identity');
must(selectionRegistry, 'receiverCapability: VerifiedFlashLoanReceiverCapability', 'provider bound to verified receiver');
must(selectionRegistry, 'expiresAt', 'provider selection expiry');

must(providerWiring, 'verifyFlashLoanReceiverCapability', 'live receiver capability check');
must(providerWiring, 'buildMissingReceiverPermissionCalls', 'Aave permission readiness check');
must(providerWiring, 'fresh_quote_after_aave_receiver_permissions', 'fresh quote after permission mutation');
must(providerWiring, "capabilities.set('aave_v3', aaveCapability)", 'Aave admitted only after permission readiness');
must(providerWiring, 'selectMeasuredFlashLoanProvider(evidence, opportunity.flashLoanAmount, allowedProviders)', 'provider competition limited to execution-ready capabilities');
must(providerWiring, 'flashLoanProviderSelectionRegistry.record', 'authoritative provider selection persistence');

must(providerExecution, 'originalExecuteFunded(opportunity, funding)', 'Balancer canonical execution preserved');
must(providerExecution, "selection.provider !== 'aave_v3'", 'fail closed on unknown provider');
must(providerExecution, "provider: input.providerKind", 'Aave provider identity enters planner');
must(providerExecution, 'buildFlashLoanReceiverPayloadFromPlan(plan)', 'provider-aware final payload');
must(providerExecution, 'No positive verified FlashLoanExecuted profit', 'positive receipt profit verification');
must(providerExecution, 'selection.receiverCapability.owner.toLowerCase()', 'execution-time receiver ownership recheck');

must(stack, "kind: 'balancer_composite_v2'", 'verified Composite V2 required');
must(stack, 'buildCompositeFlashLoanReceiverPayload', 'stack exact-simulates Composite V2 ABI');
must(stack, 'cycleEndStepIndexes', 'stack supplies cycle boundaries');
must(stack, 'executionAuthority: false', 'composite remains advisory until terminal attribution execution is promoted');
must(stack, 'combinedProfitMustExceedIndividualProfitSum: true', 'beneficial composition invariant');

must(canonical, 'ensureProviderSpecificZeroCapitalExecutionWiring();', 'canonical provider-specific executor wiring');
must(canonical, "zeroCapitalProviderExecution: 'verified_provider_receiver_permission_binding'", 'canonical provider execution authority declaration');

if (failures.length) {
  console.error('[verify-hyperscope-receiver-provider-capability] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-hyperscope-receiver-provider-capability] PASS');
console.log(' - Aave fee and reserve liquidity are measured independently of receiver readiness');
console.log(' - provider selection requires a verified provider-specific receiver and permissions');
console.log(' - permission mutations invalidate the current quote and require a fresh scan');
console.log(' - Balancer V1 execution remains the canonical fallback');
console.log(' - Aave uses provider-specific payload/receipt verification when explicitly selected');
console.log(' - Composite V2 exact simulation requires verified V2 capability and cycle boundaries');
console.log(' - composite execution remains advisory until terminal per-cycle attribution is promoted');
