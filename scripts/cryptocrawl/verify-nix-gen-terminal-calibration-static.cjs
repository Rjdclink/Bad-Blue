const fs = require('fs');

const source = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/terminal-calibration.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}
function forbidPattern(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requirePattern(/getSettlementProfitCalibrationSnapshot/, 'Nix-Gen terminal calibration must reuse the existing settlement profit calibrator');
requirePattern(/Math\.max\(0\.2, Math\.min\(1,/, 'Terminal calibration factor must remain bounded and advisory');
requirePattern(/executionAuthority: false/, 'Terminal calibration must declare no execution authority');
requirePattern(/learningAuthority: false/, 'Terminal calibration must declare no learning authority');
requirePattern(/canonicalEconomicsAuthority: false/, 'Terminal calibration must declare no canonical economics authority');
forbidPattern(/\b(?:recordSettlementProfitCalibration|recordCryptaraExecutionEvidence|updateStatus|execute[A-Za-z0-9_]*|submit[A-Za-z0-9_]*|reserve[A-Za-z0-9_]*|acquire[A-Za-z0-9_]*)\s*\(/, 'Nix-Gen terminal calibration must remain read-only and non-executing');

console.log('NIX-GEN TERMINAL CALIBRATION STATIC VERIFIER PASSED');
