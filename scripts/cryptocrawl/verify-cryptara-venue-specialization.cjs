const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const learnerPath = 'server/services/cryptara/venue-specialization-learning.ts';
const learner = read(learnerPath);

must(learnerPath, learner, "learningAuthority: 'cryptara_venue_specialization'", 'Venue specialization must remain a dedicated Cryptara learning authority');
must(learnerPath, learner, 'executionAuthority: false', 'Venue specialization must never own execution');
must(learnerPath, learner, 'canonicalEconomicsAuthority: false', 'Venue specialization must never own canonical economics');
must(learnerPath, learner, 'capitalMovementAuthority: false', 'Venue specialization must never move capital');
must(learnerPath, learner, 'terminal: true', 'Venue learning must require terminal observations');
must(learnerPath, learner, 'recordTerminalExecution', 'Venue specialization must learn from terminal execution feedback');
must(learnerPath, learner, 'freshnessWeight', 'Venue specialization must adapt to non-stationary conditions');
must(learnerPath, learner, 'Unknown/old evidence shrinks toward neutral 0.5', 'Sparse/stale learning must not veto canonical venues');
mustNot(learnerPath, learner, 'Math.random()', 'Venue specialization must not randomly rank exchanges');

console.log('Cryptara venue-specialization structural checks passed');
