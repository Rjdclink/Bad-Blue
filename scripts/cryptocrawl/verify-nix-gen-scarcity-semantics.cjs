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

const scarcity = read('server/services/cryptocrawl/optimization/nix-gen/scarcity-pricing.ts');
const readme = read('server/services/cryptocrawl/optimization/nix-gen/README.md');

requirePattern(scarcity, /normalizedScarcitySignal/, 'Heuristic utilization output must be named as a scarcity signal');
requirePattern(scarcity, /not called a shadow[\s\S]{0,120}no dual optimization model produced it/, 'Scarcity implementation must explicitly distinguish heuristic signals from true dual prices');
forbidPattern(scarcity, /normalizedShadowPrice/, 'Heuristic scarcity must not be mislabeled as a shadow price');
requirePattern(readme, /not.*dual-derived shadow prices/i, 'Documentation must preserve the heuristic-vs-dual distinction');
requirePattern(readme, /True resource\/shadow prices[\s\S]{0,180}appropriate optimization\/dual model/, 'Documentation must require a real dual model before using shadow-price terminology');

console.log('NIX-GEN SCARCITY SEMANTICS VERIFIER PASSED');
