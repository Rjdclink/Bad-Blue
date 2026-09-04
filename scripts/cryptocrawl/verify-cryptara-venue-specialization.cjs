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
const feePath = 'server/services/cryptocrawl/intelligence/cex-fee-resolver.ts';
const priorityPath = 'server/services/cryptocrawl/optimization/nix-gen/live-priority-registry.ts';
const learner = read(learnerPath);
const priors = read(priorPath);
const fees = read(feePath);
const priority = read(priorityPath);

must(learnerPath, learner, "learningAuthority: 'cryptara_venue_specialization'", 'Venue specialization must remain a dedicated Cryptara learning authority');
must(learnerPath, learner, 'executionAuthority: false', 'Venue specialization must never own execution');
must(learnerPath, learner, 'canonicalEconomicsAuthority: false', 'Venue specialization must never own canonical economics');
must(learnerPath, learner, 'capitalMovementAuthority: false', 'Venue specialization must never move capital');
must(learnerPath, learner, 'terminal: true', 'Venue learning must require terminal observations');
must(learnerPath, learner, 'recordTerminalExecution', 'Venue specialization must learn from terminal execution feedback');
must(learnerPath, learner, 'freshnessWeight', 'Venue specialization must adapt terminal evidence to non-stationary conditions');
must(learnerPath, learner, 'return { venue, role, score: 0.5, confidence: 0, sampleCount: 0 };', 'Without terminal evidence Cryptara venue specialization must be exactly neutral');
must(learnerPath, learner, 'retrospective terminal outcome telemetry', 'Historical costs/slippage must be explicitly retrospective rather than current fee truth');
must(learnerPath, learner, 'Current executable economics remain owned by the live', 'Learner must state the live authenticated economics authority boundary');
mustNot(learnerPath, learner, 'getCryptaraVenueBootstrapPrior', 'Public/documentation priors must not enter live Cryptara venue ranking');
mustNot(learnerPath, learner, 'venue-bootstrap-priors', 'Live Cryptara venue ranking must not import bootstrap priors');
mustNot(learnerPath, learner, 'bootstrapPriorConfidence', 'Bootstrap confidence must not affect live venue ranking');
mustNot(learnerPath, learner, 'bootstrapPriorSource', 'Bootstrap sources must not affect live venue ranking');
mustNot(learnerPath, learner, 'decayedBootstrapConfidence', 'Documentation-prior decay is irrelevant because priors must not enter live ranking');
mustNot(learnerPath, learner, 'Math.random()', 'Venue specialization must not randomly rank exchanges');

// Historical research metadata may remain for human/reference use, but it must
// explicitly have no execution/economics/terminal/capital authority and must not
// be consumed by the live learner above.
must(priorPath, priors, "sourceAuthority: 'public_exchange_documentation_bootstrap_only'", 'Documentation metadata must identify itself as non-live bootstrap research');
must(priorPath, priors, 'terminalEvidenceAuthority: false', 'Documentation metadata must never masquerade as terminal evidence');
must(priorPath, priors, 'executionAuthority: false', 'Documentation metadata must never gain execution authority');
must(priorPath, priors, 'canonicalEconomicsAuthority: false', 'Documentation metadata must never become canonical economics');
must(priorPath, priors, 'capitalMovementAuthority: false', 'Documentation metadata must never move capital');
mustNot(priorPath, priors, 'terminal: true', 'Documentation metadata must never be encoded as fake terminal observations');

// Executable CEX economics must come from fresh authenticated venue/account
// evidence. Configured values may exist for diagnostics, but cannot enter the
// executable fee cache. Cryptara may not be imported into this authority.
must(feePath, fees, "source: 'coinbase_transaction_summary'", 'Coinbase executable fee evidence must identify authenticated transaction-summary authority');
must(feePath, fees, "source: 'kraken_account_trade_volume'", 'Kraken executable fee evidence must identify authenticated TradeVolume authority');
must(feePath, fees, 'resolveOkxAccountFeeRates', 'OKX executable fee evidence must come from authenticated account trade-fee authority');
must(feePath, fees, "source: rates.zeroFeeGroup ? 'okx_live_spot_zero_fee_group' : 'okx_account_trade_fee'", 'OKX executable fee evidence must preserve authenticated account rates and live zero-fee groups');
must(feePath, fees, "if (evidence.source === 'configured_override') return;", 'Configured fee overrides must never enter executable fee evidence cache');
must(feePath, fees, 'observedAt', 'Fee evidence must carry observation time for freshness enforcement');
mustNot(feePath, fees, 'venue-specialization-learning', 'Canonical fee authority must never import Cryptara venue learning');
mustNot(feePath, fees, 'getCryptaraVenueSpecializationLearning', 'Canonical fee authority must never consume Cryptara learned state');
mustNot(feePath, fees, 'venue-bootstrap-priors', 'Canonical fee authority must never consume documentation/bootstrap priors');

// Cryptara may affect only the separate advisory routing value after canonical
// positive/executable economics already exist. Raw canonical profit remains a
// distinct field and the treasury threshold authority.
must(priorityPath, priority, 'if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) continue;', 'Cryptara ranking must occur only after canonical positive-profit admission');
must(priorityPath, priority, 'weightedCanonicalProfitUsd', 'Raw canonical profit demand must remain separate from learned advisory ranking');
must(priorityPath, priority, 'routingAdvisoryValueUsd', 'Learned venue specialization must be confined to a distinct advisory routing value');
must(priorityPath, priority, 'capitalMovementAuthority: false', 'Venue specialization advisory must never move capital');
const positiveGate = priority.indexOf('if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) continue;');
const learningUse = priority.indexOf('const learning = getCryptaraVenueSpecializationLearning();');
if (positiveGate < 0 || learningUse < 0 || learningUse <= positiveGate) {
  throw new Error(`${priorityPath}: Cryptara venue learning must only be consumed after canonical positive-profit filtering`);
}

console.log('Cryptara venue-specialization and canonical fee-isolation checks passed');
