const fs = require('fs');

const portfolio = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/portfolio-view.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(portfolio)) throw new Error(message);
}

function forbidPattern(pattern, message) {
  if (pattern.test(portfolio)) throw new Error(message);
}

requirePattern(/authority:\s*'nix_gen_advisory_portfolio_view'/, 'Portfolio view must identify advisory authority');
requirePattern(/executionAuthority:\s*false/, 'Portfolio view must not gain execution authority');
requirePattern(/canonicalEconomicsAuthority:\s*false/, 'Portfolio view must not gain economics authority');
requirePattern(/resourceAuthority:\s*false/, 'Portfolio view must not gain resource authority');
requirePattern(/filtersCanonicalCandidates:\s*false/, 'Portfolio view must not filter upstream candidates');
requirePattern(/replanNixGenAllocation/, 'Portfolio view must reuse the common pure replanner');
requirePattern(/priorityOrderBidIds/, 'Portfolio view must preserve the optimizer complete priority order');
requirePattern(/deferredReason/, 'Portfolio view must expose advisory deferral rather than hiding non-selected valid bids');
forbidPattern(/setInterval|setTimeout|queueMicrotask/, 'Portfolio view must not create a scheduling loop');
forbidPattern(/\b(?:acquire[A-Za-z0-9_]*|reserve[A-Za-z0-9_]*|release|submitOrder|placeOrder|executeVerifiedArbitragePlan)\s*\(/, 'Portfolio view must not mutate resources or execute trades');

console.log('NIX-GEN PORTFOLIO VIEW STATIC VERIFIER PASSED');
