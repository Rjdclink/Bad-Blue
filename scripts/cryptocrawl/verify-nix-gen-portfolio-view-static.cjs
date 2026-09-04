const fs = require('fs');
const ts = require('typescript');

const portfolio = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/portfolio-view.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(portfolio)) throw new Error(message);
}

function calledName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function forbidCalls(bannedNames, message) {
  const sourceFile = ts.createSourceFile('portfolio-view.ts', portfolio, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let violation = null;
  function visit(node) {
    if (violation) return;
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression);
      if (name && bannedNames.has(name)) {
        violation = name;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (violation) throw new Error(`${message}: ${violation}()`);
}

requirePattern(/authority:\s*'nix_gen_advisory_portfolio_view'/, 'Portfolio view must identify advisory authority');
requirePattern(/executionAuthority:\s*false/, 'Portfolio view must not gain execution authority');
requirePattern(/canonicalEconomicsAuthority:\s*false/, 'Portfolio view must not gain economics authority');
requirePattern(/resourceAuthority:\s*false/, 'Portfolio view must not gain resource authority');
requirePattern(/filtersCanonicalCandidates:\s*false/, 'Portfolio view must not filter upstream candidates');
requirePattern(/replanNixGenAllocation/, 'Portfolio view must reuse the common pure replanner');
requirePattern(/priorityOrderBidIds/, 'Portfolio view must preserve the optimizer complete priority order');
requirePattern(/deferredReason/, 'Portfolio view must expose advisory deferral rather than hiding non-selected valid bids');
forbidCalls(new Set(['setInterval', 'setTimeout', 'queueMicrotask']), 'Portfolio view must not create a scheduling loop');
forbidCalls(
  new Set(['acquire', 'reserve', 'release', 'submitOrder', 'placeOrder', 'executeVerifiedArbitragePlan']),
  'Portfolio view must not mutate resources or execute trades',
);

console.log('NIX-GEN PORTFOLIO VIEW STATIC VERIFIER PASSED');
