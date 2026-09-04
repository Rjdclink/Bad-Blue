const fs = require('fs');
const ts = require('typescript');

const source = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/terminal-calibration.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
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
  const sourceFile = ts.createSourceFile('terminal-calibration.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

requirePattern(/getSettlementProfitCalibrationSnapshot/, 'Nix-Gen terminal calibration must reuse the existing settlement profit calibrator');
requirePattern(/Math\.max\(0\.2, Math\.min\(1,/, 'Terminal calibration factor must remain bounded and advisory');
requirePattern(/executionAuthority: false/, 'Terminal calibration must declare no execution authority');
requirePattern(/learningAuthority: false/, 'Terminal calibration must declare no learning authority');
requirePattern(/canonicalEconomicsAuthority: false/, 'Terminal calibration must declare no canonical economics authority');
forbidCalls(
  new Set([
    'recordSettlementProfitCalibration',
    'recordCryptaraExecutionEvidence',
    'updateStatus',
    'execute',
    'submit',
    'reserve',
    'acquire',
    'executeVerifiedArbitragePlan',
    'submitOrder',
    'placeOrder',
    'broadcastTransaction',
    'sendTransaction',
  ]),
  'Nix-Gen terminal calibration must remain read-only and non-executing',
);
forbidCalls(new Set(['setInterval', 'setTimeout', 'queueMicrotask']), 'Nix-Gen terminal calibration must not create an independent scheduling loop');

console.log('NIX-GEN TERMINAL CALIBRATION STATIC VERIFIER PASSED');
