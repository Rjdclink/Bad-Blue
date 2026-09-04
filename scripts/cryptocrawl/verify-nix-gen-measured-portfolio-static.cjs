const fs = require('fs');

const source = fs.readFileSync('server/services/cryptocrawl/optimization/nix-gen/measured-portfolio-preparation.ts', 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}
function forbidPattern(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requirePattern(/decision\.topology === 'DEX_ATOMIC'[\s\S]*decision\.path === 'FLASH_LOAN'/, 'Measured Nix-Gen portfolio must explicitly require the existing DEX atomic execution path');
requirePattern(/decision\.topology === 'LIQUIDATION'[\s\S]*decision\.path === 'FLASH_LOAN_LIQUIDATION'/, 'Measured Nix-Gen portfolio must explicitly require the existing liquidation execution path');
requirePattern(/candidate\.status !== 'eligible'/, 'Measured Nix-Gen portfolio must preserve upstream eligibility authority');
requirePattern(/!candidate\.executableCapability/, 'Measured Nix-Gen portfolio must require upstream executable capability');
requirePattern(/candidate\.expiresAt <= now/, 'Measured Nix-Gen portfolio must reject stale preparation snapshots');
requirePattern(/executionAuthority: false/, 'Measured portfolio preparation must declare no execution authority');
requirePattern(/settlementAuthority: false/, 'Measured portfolio preparation must declare no settlement authority');
requirePattern(/resourceAuthority: false/, 'Measured portfolio preparation must declare no resource authority');
requirePattern(/mutatesCandidateState: false/, 'Measured portfolio preparation must declare that it does not mutate candidate state');
forbidPattern(/\.dispatch\s*\(|\.acquire\s*\(|\.reserve\s*\(|updateStatus\s*\(|executePrepared|executeVerifiedArbitragePlan|submitOrder|sendTransaction|broadcastTransaction/, 'Measured Nix-Gen portfolio preparation must remain read-only and non-executing');

console.log('NIX-GEN MEASURED PORTFOLIO STATIC VERIFIER PASSED');
