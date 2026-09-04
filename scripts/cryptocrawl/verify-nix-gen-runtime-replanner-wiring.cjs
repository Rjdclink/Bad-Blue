const fs = require('fs');
const ts = require('typescript');

const ordering = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/cex-ordering.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(ordering)) throw new Error(message);
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
  const sourceFile = ts.createSourceFile('cex-ordering.ts', ordering, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

requirePattern(/replanNixGenAllocation/, 'CEX advisory ordering must reuse the pure Nix-Gen replanner');
requirePattern(/previousCexReplan/, 'CEX advisory ordering must preserve the previous pure planning snapshot for unchanged-input reuse');
requirePattern(/previousCexReplan\s*=\s*replan/, 'CEX advisory ordering must update cached planning truth only after a successful replan');
requirePattern(/const enabled = process\.env\.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false'/, 'CEX advisory ordering must remain default-on with an explicit false rollback switch');
requirePattern(/if \(!enabled\) \{[\s\S]{0,260}previousCexReplan = undefined;[\s\S]{0,260}candidates: original/, 'Disabling Nix-Gen must clear cached advisory state and preserve canonical ordering immediately');
requirePattern(/if \(original\.length === 0\) \{[\s\S]{0,260}candidates: original/, 'An empty candidate set must preserve canonical ordering immediately without advisory work');
requirePattern(/if \(prepared\.length === 0\) \{[\s\S]{0,260}previousCexReplan = undefined;[\s\S]{0,260}candidates: original/, 'If no candidate can be prepared for advisory ranking, cached advisory state must clear and canonical ordering must be preserved');
requirePattern(/catch \(error\)[\s\S]{0,500}candidates:\s*original/, 'Replanner failure must fail open to the exact canonical order');
forbidCalls(new Set(['setInterval', 'setTimeout', 'queueMicrotask']), 'Nix-Gen replanner wiring must not create a competing scheduling loop');
forbidCalls(new Set(['executeVerifiedArbitragePlan', 'submitOrder', 'placeOrder', 'broadcastTransaction', 'sendTransaction']), 'Nix-Gen replanner wiring must not execute trades');

console.log('NIX-GEN RUNTIME REPLANNER WIRING STATIC VERIFIER PASSED');
