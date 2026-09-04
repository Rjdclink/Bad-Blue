const fs = require('fs');

const ordering = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/cex-ordering.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(ordering)) throw new Error(message);
}

function forbidPattern(pattern, message) {
  if (pattern.test(ordering)) throw new Error(message);
}

requirePattern(/replanNixGenAllocation/, 'CEX advisory ordering must reuse the pure Nix-Gen replanner');
requirePattern(/previousCexReplan/, 'CEX advisory ordering must preserve the previous pure planning snapshot for unchanged-input reuse');
requirePattern(/previousCexReplan\s*=\s*replan/, 'CEX advisory ordering must update cached planning truth only after a successful replan');
requirePattern(/CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING\s*!==\s*'false'/, 'Nix-Gen advisory ordering must remain default-on with an explicit false rollback switch');
requirePattern(/if \(!enabled\)\s*\{[\s\S]{0,300}previousCexReplan\s*=\s*undefined[\s\S]{0,300}candidates:\s*original/, 'Disabled Nix-Gen ordering must clear advisory state and preserve canonical ordering immediately');
requirePattern(/if \(original\.length === 0\)\s*\{[\s\S]{0,250}candidates:\s*original/, 'Empty candidate sets must preserve canonical ordering without replanning');
requirePattern(/catch \(error\)[\s\S]{0,500}candidates:\s*original/, 'Replanner failure must fail open to the exact canonical order');
forbidPattern(/setInterval|setTimeout|queueMicrotask/, 'Nix-Gen replanner wiring must not create a competing scheduling loop');
forbidPattern(/executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, 'Nix-Gen replanner wiring must not execute trades');

console.log('NIX-GEN RUNTIME REPLANNER WIRING STATIC VERIFIER PASSED');
