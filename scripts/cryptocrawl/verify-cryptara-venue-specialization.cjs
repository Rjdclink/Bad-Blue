const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const learnerPath = 'server/services/cryptara/venue-specialization-learning.ts';
const priorPath = 'server/services/cryptara/venue-bootstrap-priors.ts';
const learner = read(learnerPath);
const priors = read(priorPath);

must(learnerPath, learner, "learningAuthority: 'cryptara_venue_specialization'", 'Venue specialization must remain a dedicated Cryptara learning authority');
must(learnerPath, learner, 'executionAuthority: false', 'Venue specialization must never own execution');
must(learnerPath, learner, 'canonicalEconomicsAuthority: false', 'Venue specialization must never own canonical economics');
must(learnerPath, learner, 'capitalMovementAuthority: false', 'Venue specialization must never move capital');
must(learnerPath, learner, 'terminal: true', 'Venue learning must require terminal observations');
must(learnerPath, learner, 'recordTerminalExecution', 'Venue specialization must learn from terminal execution feedback');
must(learnerPath, learner, 'freshnessWeight', 'Venue specialization must adapt to non-stationary conditions');
must(learnerPath, learner, 'getCryptaraVenueBootstrapPrior', 'Venue ranking may consume only the dedicated bootstrap-prior surface');
must(learnerPath, learner, 'decayedBootstrapConfidence', 'Documentation priors must decay as terminal observations accumulate');
must(learnerPath, learner, 'Math.pow(0.2, Math.max(0, terminalObservations))', 'One terminal observation must sharply reduce documentation-prior influence');
must(learnerPath, learner, 'Unknown/old terminal evidence shrinks toward neutral 0.5', 'Sparse/stale terminal learning must not veto canonical venues');
mustNot(learnerPath, learner, 'Math.random()', 'Venue specialization must not randomly rank exchanges');

must(priorPath, priors, "sourceAuthority: 'public_exchange_documentation_bootstrap_only'", 'Documentation priors must identify themselves as bootstrap-only');
must(priorPath, priors, 'terminalEvidenceAuthority: false', 'Documentation priors must never masquerade as terminal evidence');
must(priorPath, priors, 'executionAuthority: false', 'Documentation priors must never gain execution authority');
must(priorPath, priors, 'canonicalEconomicsAuthority: false', 'Documentation priors must never become canonical economics');
must(priorPath, priors, 'capitalMovementAuthority: false', 'Documentation priors must never move capital');
must(priorPath, priors, 'confidence: 0.05', 'Bootstrap confidence must remain tiny');
must(priorPath, priors, 'const EXPIRES_AT = RESEARCHED_AT + 14 * DAY_MS;', 'Documentation priors must expire instead of becoming permanent truth');
must(priorPath, priors, 'const halfLifeMs = 3 * DAY_MS;', 'Documentation-prior freshness must decay quickly');
must(priorPath, priors, 'actual_account_fee_tier_is_runtime_truth', 'Coinbase bootstrap must defer to authenticated runtime fee truth');
must(priorPath, priors, 'entry_spot_fee_tier_can_be_expensive_relative_to_other_venues', 'Kraken bootstrap must preserve current low-tier fee downside');
must(priorPath, priors, 'regional_fee_and_product_rules_must_be_runtime_verified', 'OKX bootstrap must preserve regional/runtime eligibility caveat');
mustNot(priorPath, priors, 'terminal: true', 'Documentation priors must never be encoded as fake terminal observations');

console.log('Cryptara venue-specialization structural checks passed');
