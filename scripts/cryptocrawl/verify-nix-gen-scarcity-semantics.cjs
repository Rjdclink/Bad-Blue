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
requirePattern(readme, /\*\*Scarcity signal\*\*[\s\S]{0,180}not a shadow price/i, 'Documentation must explicitly state that the heuristic scarcity signal is not a shadow price');
requirePattern(readme, /\*\*Dual resource price\*\*[\s\S]{0,220}projected-subgradient Lagrangian[\s\S]{0,180}approximate/i, 'Documentation must reserve dual-price terminology for the optimization-derived Lagrangian signal and preserve its approximation limits');
requirePattern(readme, /Marginal resource value[\s\S]{0,180}not a mathematical dual variable/i, 'Documentation must keep finite-difference marginal value distinct from mathematical dual variables');

console.log('NIX-GEN SCARCITY SEMANTICS VERIFIER PASSED');
