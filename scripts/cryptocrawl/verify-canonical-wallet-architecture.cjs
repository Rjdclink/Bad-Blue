const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
};
const rejectText = (text, needle, label) => {
  if (text.includes(needle)) throw new Error(`Forbidden ${label}: ${needle}`);
};

const identity = read('server/services/cryptocrawl/core/wallet-identity.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const runtime = read('server/services/cryptocrawl/runtime/core-runtime.ts');
const treasury = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');
const across = read('server/services/cryptocrawl/bridge/across-bridge-provider.ts');
const railway = read('.env.railway.example');

requireText(identity, 'installCanonicalWalletConfiguration', 'canonical wallet bootstrap');
requireText(identity, "environment.BRIDGE_WALLET_ADDRESS = executionAddress", 'legacy bridge address aliasing');
requireText(identity, "environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS = executionAddress", 'Across depositor aliasing');
requireText(identity, 'Deprecated BRIDGE_SIGNER_PRIVATE_KEY conflicts with WALLET_PRIVATE_KEY', 'duplicate signer mismatch guard');
requireText(identity, 'resolveTerminalPayoutAddress', 'terminal payout resolver');
requireText(identity, 'resolveOperationalProfitRecipient', 'runtime profit recipient resolver');

requireText(planner, 'resolveOperationalProfitRecipient', 'zero-capital runtime retention');
rejectText(planner, 'process.env.CRYPTO_PROFIT_WALLET_ADDRESS', 'terminal payout address in active route planning');
rejectText(planner, 'process.env.BRIDGE_WALLET_ADDRESS', 'legacy bridge address in active route planning');

requireText(runtime, 'ensureCanonicalWalletConfiguration();', 'wallet bootstrap before lifecycle');
requireText(runtime, "operationalProfitDestination: 'WALLET_PRIVATE_KEY-derived execution wallet'", 'runtime profit policy telemetry');
requireText(treasury, 'resolveTerminalPayoutAddress()', 'terminal-only payout wiring');
requireText(across, 'process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS', 'Across compatibility consumer');

requireText(railway, 'WALLET_PRIVATE_KEY=', 'canonical signer documentation');
requireText(railway, 'CRYPTO_PROFIT_WALLET_ADDRESS=', 'terminal payout documentation');
requireText(railway, '# BRIDGE_SIGNER_PRIVATE_KEY=', 'deprecated duplicate signer documentation');
requireText(railway, '# WALLET_PUBLIC_KEY=', 'deprecated public-key variable documentation');

console.log(JSON.stringify({
  ok: true,
  canonicalOperationalSigner: 'WALLET_PRIVATE_KEY',
  operationalProfitRecipient: 'WALLET_PRIVATE_KEY-derived execution address',
  bridgeIdentity: 'same execution address via compatibility alias',
  terminalPayoutOnly: 'CRYPTO_PROFIT_WALLET_ADDRESS',
  duplicateSignerGuard: true,
  runtimeProfitExternalSweep: false,
}, null, 2));
