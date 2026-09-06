'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const networkPath = path.join(root, 'server/services/cryptocrawl/runtime/zero-capital-network-capability-registry.ts');
const observePath = path.join(root, 'server/services/cryptocrawl/runtime/expanded-network-observability.ts');
const externalPath = path.join(root, 'server/services/cryptocrawl/optimization/external-capital-capability-registry.ts');
const bootstrapPath = path.join(root, 'server/cryptara-bootstrap-entry.ts');
const network = fs.readFileSync(networkPath, 'utf8');
const observe = fs.readFileSync(observePath, 'utf8');
const external = fs.readFileSync(externalPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

function must(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(`[verify-nix-gen-historical-capability-preservation] ${message}`);
}

must(network, /executionAuthority:\s*false/, 'network capability registry gained execution authority');
must(network, /capitalMovementAuthority:\s*false/, 'network capability registry gained capital movement authority');
must(network, /executionReady\s*&&\s*\(!value\.providerEvidenceReady\s*\|\|\s*!value\.feePaymentEvidenceReady\s*\|\|\s*!value\.settlementEvidenceReady\)/, 'network execution readiness is not triple-evidence gated');
must(network, /chainId:\s*1329/, 'verified Sei mainnet identity was not preserved');
must(network, /cluster:\s*'mainnet-beta'/, 'Solana is not modeled as a native cluster');
must(observe, /getLatestBlockhash/, 'Solana native blockhash observation is missing');
must(observe, /executionReady:\s*false/, 'expanded network observer may promote execution readiness');
must(bootstrap, /ensureExpandedNetworkObservability/, 'expanded network observer is not installed');
must(external, /flashLoanProviderSelectionRegistry/, 'existing flash-provider authority is not explicitly preserved');
must(external, /bootstrapEligible:\s*false[\s\S]*requiresSystemOwnedCapital:\s*true[\s\S]*collateralRequired:\s*true/, 'collateralized external capital is not excluded from cold-start bootstrap');
must(external, /executionAuthority:\s*false/, 'external capital registry gained execution authority');

console.log('[verify-nix-gen-historical-capability-preservation] PASS');