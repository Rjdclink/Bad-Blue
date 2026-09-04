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

const types = read('server/services/cryptocrawl/optimization/nix-gen/types.ts');
const optimizer = read('server/services/cryptocrawl/optimization/nix-gen/global-optimizer.ts');

requirePattern(types, /decisionAuthority:\s*'advisory_only'/, 'Nix-Gen must remain advisory-only');
requirePattern(types, /executionAuthority:\s*false/, 'Nix-Gen must not gain execution authority');
requirePattern(types, /canonicalEconomicsAuthority:\s*false/, 'Nix-Gen must not gain canonical economics authority');
requirePattern(optimizer, /netProfitUsd\)\) return 'non_positive_canonical_economics'/, 'Nix-Gen must reject non-positive canonical economics');
requirePattern(optimizer, /execution_not_authoritative/, 'Nix-Gen must require an existing authoritative execution path');
requirePattern(optimizer, /settlement_not_capable/, 'Nix-Gen must require settlement capability');
requirePattern(optimizer, /expiresAt <= now/, 'Nix-Gen must reject expired bids');
requirePattern(optimizer, /mutual_exclusion/, 'Nix-Gen must enforce mutually-exclusive strategy variants');
requirePattern(optimizer, /exact_branch_and_bound/, 'Nix-Gen must retain an exact bounded optimization path');
requirePattern(optimizer, /deterministic_greedy/, 'Nix-Gen must have a deterministic bounded-cost fallback');

forbidPattern(optimizer, /executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, 'Nix-Gen foundation must not submit or execute trades');
forbidPattern(optimizer, /stageManager|killSwitch|profitLadder\./, 'Nix-Gen foundation must not override governance authorities');
forbidPattern(optimizer, /recordSettlement|recordProfit|learnFrom|training/, 'Nix-Gen foundation must not create settlement or learning authority');

console.log('NIX-GEN FOUNDATION VERIFIER PASSED');
