const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const orchestratorPath = 'server/services/cryptocrawl/capital-free/zero-initial-capital-dynamic-orchestrator.ts';
const learningPath = 'server/services/cryptara/zero-capital-funding-learning.ts';
const gasPath = 'server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts';
const enginePath = 'server/services/cryptocrawl/core/zero-capital-engine.ts';

const orchestrator = read(orchestratorPath);
const learning = read(learningPath);
const gas = read(gasPath);
const engine = read(enginePath);

must(orchestratorPath, orchestrator, 'Promise.allSettled', 'Funding preparation must be parallel and failure-isolated');
must(orchestratorPath, orchestrator, "status: 'ambiguous'", 'Ambiguous submission must quarantine the local opportunity');
must(orchestratorPath, orchestrator, 'maxRetriesPerLane', 'Every redundancy must own a bounded retry cycle');
must(orchestratorPath, orchestrator, 'canonicalEconomicsCheck', 'Every retry/submission must recheck canonical all-in economics');
must(orchestratorPath, orchestrator, 'freshnessCheck', 'Every retry/submission must revalidate freshness');
must(orchestratorPath, orchestrator, 'globalHaltAuthority: false', 'Zero-initial-capital orchestration must have no global halt authority');
must(orchestratorPath, orchestrator, 'Submission is deliberately serialized', 'Parallel preparation must not create duplicate submission authority');

must(learningPath, learning, "learningAuthority: 'cryptara_zero_initial_capital_funding'", 'Cryptara must have a dedicated funding-learning authority');
must(learningPath, learning, 'executionAuthority: false', 'Funding learning must never own execution');
must(learningPath, learning, "getCryptara().emit('zero-capital:funding-learning'", 'Funding observations must enter the Cryptara learning channel');
must(learningPath, learning, 'quote/provider failures are not trades', 'Provider failures must not contaminate realized trade calibration');

must(gasPath, gas, 'operator native-gas input is zero', 'Sponsored gas semantics must describe zero operator input rather than zero monetary gas');
must(gasPath, gas, 'rankGasFundingCandidates', 'Gas funding must expose independently rankable redundant candidates');
must(gasPath, gas, 'bootstrapEligible: false', 'Native self-funded gas must not masquerade as cold-start zero capital');

// Existing engine currently contains the global fail-closed pattern. Keep this
// assertion visible until the next wiring commit removes it; the verifier must
// fail once invoked before that repair, preventing a premature merge/preview pass.
must(enginePath, engine, 'fundingDecisions.every', 'Expected legacy global funding gate was not found; review verifier assumptions');
must(enginePath, engine, 'suspendMarketOperations', 'Expected legacy global suspension path was not found; review verifier assumptions');
mustNot(orchestratorPath, orchestrator, 'Promise.any(input.lanes.map(lane => lane.execute', 'Execution must never race multiple live submissions');

console.log('zero-initial-capital dynamic redundancy primitives: structural checks passed; global engine wiring still intentionally pending');
