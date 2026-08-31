'use strict';
// Diagnostic isolation only. Do not merge this branch.
const { verifyProfitLadderNotionalContract } = require('./lib/pr482-canonical-contract.cjs');
verifyProfitLadderNotionalContract();
console.log('[deployment-preflight][diagnostic] profit-ladder/notional canonical contract passed; continuing to downstream build');
