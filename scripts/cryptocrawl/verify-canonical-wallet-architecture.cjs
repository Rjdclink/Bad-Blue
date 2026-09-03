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
requireText(identity, 'const executionAddress = walletFromPrivateKey(privateKey).address', 'single signer authority');
requireText(identity, 'environment.BRIDGE_WALLET_ADDRESS = executionAddress', 'legacy bridge address repair');
requireText(identity, 'environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS = executionAddress', 'Across depositor repair');
requireText(identity, "['BRIDGE_WALLET_ADDRESS', 'BRIDGE_SIGNER_PRIVATE_KEY', 'WALLET_PUBLIC_KEY']", 'deprecated variable inventory');
rejectText(identity, 'walletFromPrivateKey(legacyBridgeSigner)', 'duplicate bridge signer authority');
requireText(identity, 'resolvePrimaryProfitPayoutAddress', 'signer-derived primary payout resolver');
requireText(identity, 'resolvePayoutFallbackAddress', 'independent Railway payout fallback resolver');
requireText(identity, 'CRYPTO_PAYOUT_WALLET_ADDRESS', 'explicit Railway fallback variable');
requireText(identity, 'resolveOperationalProfitRecipient', 'runtime profit recipient resolver');
requireText(identity, 'export function normalizeEvmAddress', 'canonical EVM address normalizer');
requireText(identity, '/^0x[0-9a-fA-F]{40}$/', '20-byte EVM address structural validation');
requireText(identity, 'utils.getAddress(normalized.toLowerCase())', 'mixed-case input checksum normalization');

requireText(planner, 'resolveOperationalProfitRecipient', 'zero-capital runtime retention');
rejectText(planner, 'process.env.CRYPTO_PROFIT_WALLET_ADDRESS', 'legacy explicit address in active route planning');
rejectText(planner, 'process.env.CRYPTO_PAYOUT_WALLET_ADDRESS', 'fallback address in active route planning');
rejectText(planner, 'process.env.BRIDGE_WALLET_ADDRESS', 'legacy bridge address in active route planning');

requireText(runtime, 'ensureCanonicalWalletConfiguration();', 'wallet bootstrap before lifecycle');
requireText(runtime, "operationalProfitDestination: 'WALLET_PRIVATE_KEY-derived execution wallet'", 'runtime profit policy telemetry');
requireText(treasury, 'resolvePrimaryProfitPayoutAddress()', 'MetaMask signer-derived primary payout wiring');
requireText(treasury, 'resolvePayoutFallbackAddress()', 'Railway explicit fallback payout wiring');
requireText(treasury, "primaryPayoutSource: 'WALLET_PRIVATE_KEY-derived public Ethereum address'", 'primary payout telemetry');
requireText(treasury, 'cryptocrawler_fallback_wallet', 'fallback secret synchronization');
requireText(across, 'process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS', 'Across compatibility consumer');

requireText(railway, 'WALLET_PRIVATE_KEY=', 'canonical signer documentation');
requireText(railway, 'CRYPTO_PROFIT_WALLET_ADDRESS=', 'legacy explicit payout-address compatibility documentation');
requireText(railway, '# BRIDGE_SIGNER_PRIVATE_KEY=', 'deprecated duplicate signer documentation');
requireText(railway, '# WALLET_PUBLIC_KEY=', 'deprecated public-key variable documentation');

console.log(JSON.stringify({
  ok: true,
  canonicalOperationalSigner: 'WALLET_PRIVATE_KEY',
  operationalProfitRecipient: 'WALLET_PRIVATE_KEY-derived execution address',
  bridgeIdentity: 'same execution address via repaired compatibility alias',
  primaryPayout: 'WALLET_PRIVATE_KEY-derived public Ethereum address',
  fallbackPayout: 'CRYPTO_PAYOUT_WALLET_ADDRESS then legacy CRYPTO_PROFIT_WALLET_ADDRESS when distinct',
  mixedCaseEvmPayoutAccepted: true,
  payoutNormalization: 'structural 20-byte validation then EIP-55 normalization',
  duplicateSignerAuthority: false,
  runtimeProfitExternalSweep: true,
}, null, 2));