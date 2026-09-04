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

const marginal = read('server/services/cryptocrawl/optimization/nix-gen/marginal-resource-value.ts');

requirePattern(marginal, /authority:\s*'nix_gen_advisory_marginal_resource_value'/, 'Marginal resource value must identify advisory authority');
requirePattern(marginal, /executionAuthority:\s*false/, 'Marginal resource value must not gain execution authority');
requirePattern(marginal, /resourceAuthority:\s*false/, 'Marginal resource value must not gain resource authority');
requirePattern(marginal, /canonicalEconomicsAuthority:\s*false/, 'Marginal resource value must not gain canonical economics authority');
requirePattern(marginal, /filtersCanonicalCandidates:\s*false/, 'Marginal resource value must not filter canonical candidates');
requirePattern(marginal, /isDualShadowPrice:\s*false/, 'Finite-difference marginal value must not be mislabeled as a dual shadow price');
requirePattern(marginal, /advisory:\s*undefined/, 'Marginal canonical-profit analysis must strip advisory modifiers');
requirePattern(marginal, /HARD_MAX_RESOURCES\s*=\s*64/, 'Marginal analysis must have a hard resource-count compute bound');
requirePattern(marginal, /baseline\.resourceUsage/, 'Marginal analysis must reuse optimizer-normalized resource capacities');
forbidPattern(marginal, /normalizedShadowPrice|dualPrice/, 'Marginal finite-difference diagnostics must not invent dual-price semantics');
forbidPattern(marginal, /\b(?:acquire[A-Za-z0-9_]*|reserve[A-Za-z0-9_]*|release|submitOrder|placeOrder|executeVerifiedArbitragePlan)\s*\(/, 'Marginal analysis must remain non-mutating and non-executing');
forbidPattern(marginal, /setInterval|setTimeout|queueMicrotask/, 'Marginal analysis must not create a scheduling loop');

console.log('NIX-GEN MARGINAL RESOURCE VALUE STATIC VERIFIER PASSED');
