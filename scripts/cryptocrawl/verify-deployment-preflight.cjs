'use strict';
// Diagnostic isolation only. Do not merge this branch.
// Run the canonical PR #482 execution/notional contract, then continue directly
// toward the application build after the downstream diagnostic no-ops.

const {
  verifyCexExecutionContract,
  verifyProfitLadderNotionalContract,
} = require('./lib/pr482-canonical-contract.cjs');

verifyCexExecutionContract();
verifyProfitLadderNotionalContract();

console.log('[deployment-preflight][diagnostic] canonical PR #482 contract passed; continuing to downstream build');
