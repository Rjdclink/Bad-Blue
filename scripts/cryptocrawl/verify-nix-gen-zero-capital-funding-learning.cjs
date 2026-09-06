'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const observerPath = path.join(root, 'server/services/cryptocrawl/evolution/zero-capital-funding-lifecycle-observer.ts');
const terminalPath = path.join(root, 'server/services/cryptocrawl/evolution/terminal-network-funding-learning.ts');
const bootstrapPath = path.join(root, 'server/cryptara-bootstrap-entry.ts');
const observer = fs.readFileSync(observerPath, 'utf8');
const terminal = fs.readFileSync(terminalPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

function must(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(`[verify-nix-gen-zero-capital-funding-learning] ${message}`);
}

must(observer, /measuredCandidateRegistry\.onUpdate\(observe\)/, 'candidate lifecycle observer is not attached');
must(observer, /candidate\.topology\s*!==\s*'ZERO_CAPITAL_ATOMIC'/, 'observer is not scoped to zero-capital candidates');
must(observer, /getCryptaraZeroInitialCapitalFundingLearning\(\)\.record/, 'funding learning is not receiving candidate lifecycle observations');
must(observer, /executionAuthority:\s*false/, 'observer must not have execution authority');
must(observer, /canonicalEconomicsAuthority:\s*false/, 'observer must not have canonical economics authority');
must(observer, /candidateMutationAuthority:\s*false/, 'observer must not mutate canonical candidates');
must(terminal, /recordTerminalNetworkAndFundingLearning/, 'terminal learning fan-out is missing');
must(terminal, /stage:\s*'settlement'/, 'terminal zero-capital provider learning is missing settlement observations');
must(terminal, /executionAuthority:\s*false/, 'terminal learning must not have execution authority');
must(bootstrap, /ensureZeroCapitalFundingLifecycleObserver/, 'funding lifecycle observer is not installed at production bootstrap');

console.log('[verify-nix-gen-zero-capital-funding-learning] PASS');
