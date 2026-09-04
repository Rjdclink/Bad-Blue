const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const registryPath = 'server/services/cryptocrawl/runtime/zero-capital-network-capability-registry.ts';
const observerPath = 'server/services/cryptocrawl/runtime/expanded-network-observability.ts';
const learningPath = 'server/services/cryptara/network-specialization-learning.ts';
const rpcPath = 'server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts';

const registry = read(registryPath);
const observer = read(observerPath);
const learning = read(learningPath);
const rpc = read(rpcPath);

must(registryPath, registry, "id: 'evm:sei'", 'Sei EVM must be represented explicitly');
must(registryPath, registry, 'chainId: 1329', 'Sei chain identity must be exact');
must(registryPath, registry, "id: 'solana:mainnet-beta'", 'Solana must use native cluster identity');
must(registryPath, registry, "cluster: 'mainnet-beta'", 'Solana mainnet cluster must be explicit');
mustNot(registryPath, registry, 'chainId: 0', 'Solana must never masquerade as an EVM chain');
must(registryPath, registry, 'executionAuthority: false', 'Capability registry must remain advisory');
must(registryPath, registry, 'capitalMovementAuthority: false', 'Capability registry must not move capital');

must(observerPath, observer, "rpc(capability.rpcUrl, 'eth_chainId')", 'Sei discovery must verify live chain identity');
must(observerPath, observer, "rpc(capability.rpcUrl, 'getLatestBlockhash'", 'Solana discovery must verify fresh native transaction lifetime evidence');
must(observerPath, observer, 'executionReady: false', 'Observed networks must remain fail-closed until full execution capability exists');
must(observerPath, observer, 'fakeEvmChainIdZero: false', 'Runtime observability must explicitly reject fake Solana EVM identity');

must(learningPath, learning, 'terminal: true', 'Cryptara network profitability learning must require terminal evidence');
must(learningPath, learning, 'executionAuthority: false', 'Cryptara network learning must remain advisory');
must(learningPath, learning, 'canonicalEconomicsAuthority: false', 'Cryptara network learning must not own economics');

must(rpcPath, rpc, 'ensureExpandedNetworkObservability();', 'Expanded network observer must be installed by canonical runtime');

console.log('expanded zero-capital capability mesh: structural checks passed');
