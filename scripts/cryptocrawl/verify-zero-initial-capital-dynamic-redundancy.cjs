const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const orchestratorPath = 'server/services/cryptocrawl/capital-free/zero-initial-capital-dynamic-orchestrator.ts';
const learningPath = 'server/services/cryptara/zero-capital-funding-learning.ts';
const gasPath = 'server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts';
const sponsorPath = 'server/services/cryptocrawl/strategies/gas-sponsorship.ts';
const receiverPath = 'server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.ts';
const builderPath = 'server/services/cryptocrawl/execution/adapters/builder-sponsored-bundle.ts';
const enginePath = 'server/services/cryptocrawl/core/zero-capital-engine.ts';
const dynamicExecutionPath = 'server/services/cryptocrawl/runtime/zero-initial-capital-dynamic-execution-wiring.ts';
const strictPolicyPath = 'server/services/cryptocrawl/runtime/strict-zero-initial-capital-policy-wiring.ts';
const balancerGuardPath = 'server/services/cryptocrawl/runtime/balancer-operational-profit-recipient-wiring.ts';
const postOpReportingPath = 'server/services/cryptocrawl/runtime/zero-capital-postop-cost-reporting-wiring.ts';
const orderingSeamPath = 'server/services/cryptocrawl/runtime/alchemy-standard-rpc-first-wiring.ts';
const outerOrderingSeamPath = 'server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts';
const dockerPath = 'Dockerfile';
const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';

const orchestrator = read(orchestratorPath);
const learning = read(learningPath);
const gas = read(gasPath);
const sponsor = read(sponsorPath);
const receiver = read(receiverPath);
const builder = read(builderPath);
const engine = read(enginePath);
const dynamicExecution = read(dynamicExecutionPath);
const strictPolicy = read(strictPolicyPath);
const balancerGuard = read(balancerGuardPath);
const postOpReporting = read(postOpReportingPath);
const orderingSeam = read(orderingSeamPath);
const outerOrderingSeam = read(outerOrderingSeamPath);
const docker = read(dockerPath);
const schema = read(schemaPath);

must(orchestratorPath, orchestrator, 'Promise.allSettled', 'Funding preparation must be parallel and failure-isolated');
must(orchestratorPath, orchestrator, "status: 'ambiguous'", 'Ambiguous submission must quarantine the local opportunity');
must(orchestratorPath, orchestrator, 'maxRetriesPerLane', 'Every redundancy must own a bounded retry cycle');
must(orchestratorPath, orchestrator, 'canonicalEconomicsCheck', 'Every retry/submission must recheck canonical all-in economics');
must(orchestratorPath, orchestrator, 'freshnessCheck', 'Every retry/submission must revalidate freshness');
must(orchestratorPath, orchestrator, 'globalHaltAuthority: false', 'Zero-initial-capital orchestration must have no global halt authority');
must(orchestratorPath, orchestrator, 'Submission is deliberately serialized', 'Parallel preparation must not create duplicate submission authority');
mustNot(orchestratorPath, orchestrator, 'Promise.any(input.lanes.map(lane => lane.execute', 'Execution must never race multiple live submissions');

must(learningPath, learning, "learningAuthority: 'cryptara_zero_initial_capital_funding'", 'Cryptara must have a dedicated funding-learning authority');
must(learningPath, learning, 'executionAuthority: false', 'Funding learning must never own execution');
must(learningPath, learning, 'quote/provider failures are not trades', 'Provider failures must not contaminate realized trade calibration');

must(gasPath, gas, 'operator native-gas input is zero', 'Sponsored gas semantics must describe zero operator input rather than zero monetary gas');
must(gasPath, gas, 'rankGasFundingCandidates', 'Gas funding must expose independently rankable redundant candidates');
must(gasPath, gas, 'bootstrapEligible: false', 'Native self-funded gas must not masquerade as cold-start zero capital');

must(sponsorPath, sponsor, 'balanceCheck: false', 'Opportunity-backed gas must allow execution-created fee-token balance');
must(sponsorPath, sponsor, 'hardMaxTokenAmount', 'Opportunity-backed gas must cap provider charge below guaranteed residual');
must(sponsorPath, sponsor, 'minimumResidualAfterGasTokenAmount', 'Opportunity-backed gas must preserve a residual-profit floor');
must(receiverPath, receiver, "fundingMode === 'sponsored'", 'Receiver bootstrap must support sponsored deployment');
must(receiverPath, receiver, 'inspectExistingReceiver', 'Existing zero-cost receiver deployment must be reused before creating infrastructure');

must(builderPath, builder, 'operatorNativeGasInputRequired: false', 'Builder sponsorship must require zero operator native-gas input');
must(builderPath, builder, 'Submission is intentionally single-builder', 'Builder redundancies must not race live submissions');
must(builderPath, builder, 'guaranteedBuilderPaymentWei', 'Builder sponsorship must require guaranteed repayment economics');

mustNot(enginePath, engine, 'fundingDecisions.every', 'A route-local funding failure must never become a global all-routes gate');
must(enginePath, engine, 'configuredRoutesRetained: true', 'Configured routes must survive temporary funding/provider degradation');
must(enginePath, engine, 'Global market operations are not gated by local Zero Initial Capital funding availability', 'StageManager must remain independent of route-local funding');
must(enginePath, engine, 'Local funding loss callback intentionally suppressed', 'Local funding loss must not call the global shutdown callback');
must(enginePath, engine, 'this.startScanningLoop();', 'Scanning must remain active independently of local funding readiness');

must(dynamicExecutionPath, dynamicExecution, 'getZeroInitialCapitalDynamicOrchestrator', 'The live funding wrapper must invoke the dynamic funding orchestrator');
must(dynamicExecutionPath, dynamicExecution, 'operatorNativeGasInputRequired: false', 'Live lanes must distinguish zero-operator-input funding from ordinary wallet gas');
must(dynamicExecutionPath, dynamicExecution, 'profitRecipient: wallet.address', 'Atomic profit must remain with the operational wallet before Rainbow routing');
must(dynamicExecutionPath, dynamicExecution, "kind: 'opportunity_erc20_postop'", 'Opportunity-backed postOp gas must be a first-class live lane');
must(dynamicExecutionPath, dynamicExecution, "kind: 'system_native'", 'Proven system-native gas must remain a self-funded lane');
must(dynamicExecutionPath, dynamicExecution, 'provenSystemNativeGasAvailable', 'Wallet native balance alone must never authorize self-funded gas');
must(dynamicExecutionPath, dynamicExecution, 'parallelPreparation: true', 'Live wrapper must preserve parallel funding preparation');
must(dynamicExecutionPath, dynamicExecution, 'serializedSubmission: true', 'Live wrapper must preserve one submission authority');
must(dynamicExecutionPath, dynamicExecution, 'ambiguousSubmissionFallbackAllowed: false', 'Ambiguous submissions must not fall through to a second funding lane');

must(strictPolicyPath, strictPolicy, "id.includes('external-sponsor')", 'Operator-billed ordinary sponsorship must be excluded from strict cold-start admission');
must(strictPolicyPath, strictPolicy, 'ordinaryOperatorBilledSponsorshipColdStartEligible: false', 'Strict mode must state that operator-billed sponsorship is not zero-capital');
must(strictPolicyPath, strictPolicy, 'opportunityBackedErc20PostOpColdStartEligible: true', 'Opportunity-backed output-paid gas must remain cold-start eligible');
must(strictPolicyPath, strictPolicy, 'strictByDefault: true', 'Strict zero-operator-cost semantics must be the default');

must(balancerGuardPath, balancerGuard, "profitRecipient: wallet.address", 'Self-funded Balancer profit must stay operational before Rainbow');
must(balancerGuardPath, balancerGuard, "funding.mode === 'native'", 'Balancer guard must be limited to native self-funded execution');
must(balancerGuardPath, balancerGuard, 'operatorNativeGasInputRequired === false', 'Balancer guard must require upstream system-native provenance decision');

must(postOpReportingPath, postOpReporting, "result?.fundingMode !== 'opportunity_erc20_postop'", 'PostOp reporting guard must be scoped to opportunity-backed gas');
must(postOpReportingPath, postOpReporting, 'gasUsd: providerFeeUsd', 'Measured postOp token gas cost must survive terminal reporting');
must(postOpReportingPath, postOpReporting, 'no_double_subtraction', 'PostOp fee must not be subtracted from already-net profit twice');

must(orderingSeamPath, orderingSeam, 'ensureBalancerOperationalProfitRecipientWiring();', 'Canonical inner seam must install Balancer recipient guard');
must(orderingSeamPath, orderingSeam, 'ensureStrictZeroInitialCapitalPolicyWiring();', 'Canonical inner seam must install strict funding admission');
must(orderingSeamPath, orderingSeam, 'ensureZeroInitialCapitalDynamicExecutionWiring();', 'Canonical runtime must install dynamic funding before realized-profit reconciliation');
must(orderingSeamPath, orderingSeam, 'dynamicZeroInitialCapitalFundingInstalledAtCanonicalOrderingSeam: true', 'Runtime ordering seam must self-report dynamic funding installation');
must(outerOrderingSeamPath, outerOrderingSeam, 'ensureZeroCapitalPostOpCostReportingWiring();', 'Canonical outer seam must preserve postOp cost after realized reconciliation');

must(schemaPath, schema, "'042_cryptocrawler_coinbase_system_capital_rainbow.sql'", 'Overflow schema must provision Coinbase/Rainbow migration 042');
must(dockerPath, docker, '042_cryptocrawler_coinbase_system_capital_rainbow.sql', 'Production image must contain migration 042');
must(dockerPath, docker, 'verify-zero-initial-capital-dynamic-redundancy.cjs', 'Production build must run the zero-capital structural gate');

console.log('zero-initial-capital dynamic redundancy: structural checks passed');
