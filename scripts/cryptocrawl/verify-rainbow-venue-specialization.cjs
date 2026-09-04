const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const wiringPath = 'server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts';
const learnerPath = 'server/services/cryptara/venue-specialization-learning.ts';
const wiring = read(wiringPath);
const learner = read(learnerPath);

must(wiringPath, wiring, 'getCryptaraVenueSpecializationLearning().recordTerminalExecution(feedback)', 'Rainbow must feed terminal execution truth into Cryptara venue learning');
must(wiringPath, wiring, "retainedCapitalCexRoutingTargets: ['coinbase', 'kraken', 'okx']", 'Rainbow must expose exactly Coinbase, Kraken and OKX as CEX retained-capital routing targets');
must(wiringPath, wiring, "externalRetainedCapitalDestinationAuthority: 'external_capability_registry_advisory'", 'External retained-capital destinations must remain on a separate advisory authority surface');
must(wiringPath, wiring, 'externalCapitalMovementRequiresProviderSpecificExecutionReadyProof: true', 'External retained-capital movement must remain fail-closed until provider-specific lifecycle proof exists');
must(wiringPath, wiring, 'externalCapitalAdvisoryCapitalMovementAuthority: false', 'External retained-capital advisory must not move capital');
must(wiringPath, wiring, 'venueSpecializationExecutionAuthority: false', 'Rainbow must not elevate venue learning into execution authority');
must(learnerPath, learner, "role: 'execution'", 'Cryptara must learn execution specialization');
must(learnerPath, learner, "role: 'settlement'", 'Cryptara must learn settlement specialization');
must(learnerPath, learner, "role: 'retained_capital'", 'Cryptara must learn retained-capital specialization');
mustNot(learnerPath, learner, 'Math.random()', 'Venue ranking must be evidence-driven, not randomized');

console.log('Rainbow/Cryptara venue specialization wiring checks passed');
