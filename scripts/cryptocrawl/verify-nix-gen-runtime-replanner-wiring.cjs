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
requirePattern(/if \(!enabled \|\| original\.length < 2\)/, 'Disabled/degenerate Nix-Gen ordering must preserve canonical ordering immediately');
requirePattern(/if \(!enabled\) previousCexReplan = undefined/, 'Disabling Nix-Gen must clear cached advisory plan state');
requirePattern(/catch \(error\)[\s\S]{0,500}candidates:\s*original/, 'Replanner failure must fail open to the exact canonical order');
forbidPattern(/setInterval|setTimeout|queueMicrotask/, 'Nix-Gen replanner wiring must not create a competing scheduling loop');
forbidPattern(/executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, 'Nix-Gen replanner wiring must not execute trades');

console.log('NIX-GEN RUNTIME REPLANNER WIRING STATIC VERIFIER PASSED');
