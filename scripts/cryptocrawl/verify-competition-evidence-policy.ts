import assert from 'node:assert/strict';
import {
  competitionThreatContribution,
  evaluateCompetitionEvidence,
  finiteReasoningInput,
  resolveCompetitionEvidence,
} from '../../server/services/cryptocrawl/faucet/competition-evidence-policy.js';

const unavailableMempool = {
  available: false,
  observedAt: null,
  provenance: [],
  totalPending: 0,
  swapTransactions: 0,
  liquidityAdditions: 0,
  largeTransfers: 0,
  arbitrageOpportunities: [],
  avgGasPrice: 0,
  maxGasPrice: 0,
};

const cex = resolveCompetitionEvidence({ topology: 'CEX_CEX', mempool: unavailableMempool });
assert.equal(cex.status, 'not_applicable');
assert.equal(cex.level, null);
const cexDecision = evaluateCompetitionEvidence(cex, 0.7);
assert.equal(cexDecision.passed, true);
assert.match(cexDecision.details, /N\/A for CEX_CEX/);
assert.doesNotMatch(cexDecision.details, /NaN/);
assert.equal(competitionThreatContribution(cex), 0);

const unavailableOnchain = resolveCompetitionEvidence({ topology: 'ONCHAIN', mempool: unavailableMempool });
assert.equal(unavailableOnchain.status, 'unavailable');
const unavailableDecision = evaluateCompetitionEvidence(unavailableOnchain, 0.7);
assert.equal(unavailableDecision.passed, false);
assert.match(unavailableDecision.details, /unknown/);
assert.doesNotMatch(unavailableDecision.details, /NaN/);
assert.equal(competitionThreatContribution(unavailableOnchain), 0);

const measured = resolveCompetitionEvidence({
  topology: 'ONCHAIN',
  mempool: {
    ...unavailableMempool,
    available: true,
    observedAt: Date.now(),
    totalPending: 20,
    arbitrageOpportunities: Array.from({ length: 4 }, (_, index) => ({ hash: String(index) } as any)),
  },
});
assert.equal(measured.status, 'measured');
assert.equal(measured.level, 0.2);
assert.equal(evaluateCompetitionEvidence(measured, 0.7).passed, true);
assert.equal(competitionThreatContribution(measured), 0.06);

const excessive = resolveCompetitionEvidence({
  topology: 'ONCHAIN',
  mempool: {
    ...unavailableMempool,
    available: true,
    observedAt: Date.now(),
    totalPending: 10,
    arbitrageOpportunities: Array.from({ length: 9 }, (_, index) => ({ hash: String(index) } as any)),
  },
});
assert.equal(evaluateCompetitionEvidence(excessive, 0.7).passed, false);

assert.equal(finiteReasoningInput(Number.NaN), null);
assert.equal(finiteReasoningInput(Number.POSITIVE_INFINITY), null);
assert.equal(finiteReasoningInput(0.42), 0.42);

console.log('competition-evidence-policy:pass');
