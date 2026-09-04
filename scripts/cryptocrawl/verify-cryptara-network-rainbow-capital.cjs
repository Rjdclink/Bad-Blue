const fs = require('fs');
function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) { if (!text.includes(needle)) throw new Error(`${message} (${path})`); }
function mustNot(path, text, needle, message) { if (text.includes(needle)) throw new Error(`${message} (${path})`); }

const learningPath = 'server/services/cryptara/network-specialization-learning.ts';
const wiringPath = 'server/services/cryptocrawl/runtime/zero-capital-network-learning-wiring.ts';
const postOpPath = 'server/services/cryptocrawl/runtime/zero-capital-postop-cost-reporting-wiring.ts';
const advisoryPath = 'server/services/cryptocrawl/optimization/rainbow-capital-destination-advisory.ts';
const rainbowPath = 'server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts';
const externalPath = 'server/services/cryptocrawl/optimization/external-capital-capability-registry.ts';

const learning = read(learningPath);
const wiring = read(wiringPath);
const postOp = read(postOpPath);
const advisory = read(advisoryPath);
const rainbow = read(rainbowPath);
const external = read(externalPath);

must(learningPath, learning, 'terminal: true', 'Cryptara network learning must accept terminal truth only');
must(learningPath, learning, 'executionAuthority: false', 'Network learner must never execute');
must(learningPath, learning, 'canonicalEconomicsAuthority: false', 'Network learner must never own economics');

must(wiringPath, wiring, 'normalized.terminal !== true', 'Network learning wrapper must reject non-terminal outcomes');
must(wiringPath, wiring, 'normalized.settlementConfirmed !== true', 'Network learning wrapper must require confirmed settlement');
must(wiringPath, wiring, 'rpcHealthAsProfitabilityTruth: false', 'RPC health must not contaminate profitability learning');
must(wiringPath, wiring, 'quoteEvidenceAsProfitabilityTruth: false', 'Quotes must not contaminate terminal profitability learning');
must(wiringPath, wiring, "record('atomic_principal'", 'Terminal principal-provider evidence must teach Cryptara');
must(wiringPath, wiring, "record('fee_payment'", 'Terminal fee-payment evidence must teach Cryptara');
must(wiringPath, wiring, "record('retained_capital'", 'Proven retained-capital outcomes must teach Cryptara');
mustNot(wiringPath, wiring, 'sendTransaction(', 'Learning wrapper must not submit transactions');

must(postOpPath, postOp, 'ensureZeroCapitalNetworkLearningWiring();', 'Network learner must be installed outside corrected postOp reporting');
must(postOpPath, postOp, 'terminalNetworkLearningOutsideCorrectedReportingBoundary: true', 'Runtime must self-report terminal-learning ordering');

must(advisoryPath, advisory, "authority: 'rainbow_capital_destination_advisory'", 'Rainbow must expose one external-capital advisory surface');
must(advisoryPath, advisory, 'executionAuthority: false', 'Rainbow external advisory must not execute');
must(advisoryPath, advisory, 'capitalMovementAuthority: false', 'Rainbow external advisory must not move capital');
must(advisoryPath, advisory, 'candidate.executionReady === true', 'External retained capital must be actionable only after execution proof');
must(advisoryPath, advisory, 'candidate.economicScore > 0', 'External retained capital must require positive measured economics');
mustNot(advisoryPath, advisory, 'Math.random', 'Rainbow capital destination ranking must be deterministic');

must(rainbowPath, rainbow, 'getRainbowCapitalDestinationAdvisory', 'Rainbow terminal treasury path must consume the unified capital advisory');
must(rainbowPath, rainbow, 'externalCandidateCapitalMovementAuthority: false', 'Rainbow logs must preserve advisory-only external capital authority');
must(rainbowPath, rainbow, 'externalCapitalMovementRequiresProviderSpecificExecutionReadyProof: true', 'External capital movement must require provider-specific lifecycle proof');

must(externalPath, external, "id: 'morpho-midnight-lend:base'", 'Morpho fixed lending must be represented separately');
must(externalPath, external, "id: 'morpho-midnight-borrow:base'", 'Morpho fixed borrowing must be represented separately');

console.log('cryptara network + rainbow capital: structural checks passed');
