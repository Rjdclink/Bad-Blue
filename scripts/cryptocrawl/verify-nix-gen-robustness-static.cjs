const fs = require('fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

function forbidPattern(text, pattern, message) {
  if (pattern.test(text)) throw new Error(message);
}

const robust = read('server/services/cryptocrawl/optimization/nix-gen/robust-uncertainty.ts');
const index = read('server/services/cryptocrawl/optimization/nix-gen/index.ts');

requirePattern(robust, /authority:\s*'nix_gen_advisory_robustness'/, 'Robustness must identify advisory authority');
requirePattern(robust, /executionAuthority:\s*false/, 'Robustness must not gain execution authority');
requirePattern(robust, /canonicalEconomicsAuthority:\s*false/, 'Robustness must not gain canonical economics authority');
requirePattern(robust, /filtersCanonicalCandidates:\s*false/, 'Robustness must not filter canonical candidates');
requirePattern(robust, /reserveUsd:\s*number\s*\|\s*null/, 'Missing robustness evidence must remain explicitly unknown');
requirePattern(robust, /robustAdvisoryValueUsd:\s*number\s*\|\s*null/, 'Robust advisory value must remain nullable when evidence is incomplete');
requirePattern(robust, /input\.bid\.economics\.netProfitUsd\s*-\s*reserveUsd/, 'Robust value must be derived without rewriting canonical economics');
requirePattern(robust, /input\.components\.length\s*>\s*0\s*&&\s*invalidEvidence\.length\s*===\s*0/, 'Robustness must require explicit valid evidence before computing a reserve');
requirePattern(index, /export \* from '\.\/robust-uncertainty\.js'/, 'Robustness library must be exported through the Nix-Gen index');

forbidPattern(robust, /executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, 'Robustness must not submit or execute trades');
forbidPattern(robust, /stageManager\.|killSwitch\.|profitLadder\./, 'Robustness must not override governance authorities');
forbidPattern(robust, /recordSettlement|recordProfit|learnFrom|training/, 'Robustness must not create settlement or learning authority');
forbidPattern(robust, /setInterval|setTimeout|queueMicrotask/, 'Robustness must remain a pure library without a competing loop');

console.log('NIX-GEN ROBUSTNESS STATIC VERIFIER PASSED');
