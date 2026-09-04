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
const dockerPath = 'Dockerfile';
const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';

const orchestrator = read(orchestratorPath);
const learning = read(learningPath);
const gas = read(gasPath);
const sponsor = read(sponsorPath);
const receiver = read(receiverPath);
const builder = read(builderPath);
const engine = read(enginePath);
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
must(enginePath, engine, 'getZeroInitialCapitalDynamicOrchestrator', 'The live executor must invoke the dynamic funding orchestrator');
must(enginePath, engine, 'operatorNativeGasInputRequired', 'The live lane set must distinguish cold-start from self-funded native gas');
must(enginePath, engine, 'profitRecipient: wallet.address', 'Atomic profit must stay with the operational wallet before Rainbow payout routing');

must(schemaPath, schema, "'042_cryptocrawler_coinbase_system_capital_rainbow.sql'", 'Overflow schema must provision Coinbase/Rainbow migration 042');
must(dockerPath, docker, '042_cryptocrawler_coinbase_system_capital_rainbow.sql', 'Production image must contain migration 042');
must(dockerPath, docker, 'verify-zero-initial-capital-dynamic-redundancy.cjs', 'Production build must run the zero-capital structural gate');

console.log('zero-initial-capital dynamic redundancy: structural checks passed');
