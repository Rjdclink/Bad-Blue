const fs = require('fs');
const ts = require('typescript');

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

function calledName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function forbidCalls(sourceText, bannedNames, message) {
  const sourceFile = ts.createSourceFile('marginal-resource-value.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
forbidCalls(
  marginal,
  new Set(['acquire', 'reserve', 'release', 'submitOrder', 'placeOrder', 'executeVerifiedArbitragePlan']),
  'Marginal analysis must remain non-mutating and non-executing',
);
forbidCalls(
  marginal,
  new Set(['setInterval', 'setTimeout', 'queueMicrotask']),
  'Marginal analysis must not create a scheduling loop',
);

console.log('NIX-GEN MARGINAL RESOURCE VALUE STATIC VERIFIER PASSED');
