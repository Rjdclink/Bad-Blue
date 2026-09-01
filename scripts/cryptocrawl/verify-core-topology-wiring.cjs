const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
}

const core = read('server/services/cryptocrawl/runtime/core-runtime.ts');
const lifecycle = read('server/services/cryptocrawl/runtime/core-runtime-lifecycle.ts');
const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const faucetWiring = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const rpcFallbackPolicy = read('server/services/cryptocrawl/runtime/rpc-fallback-admission-policy.ts');

requireText(core, "import('../discovery/multi-topology-discovery-controller.js')", 'core runtime lazily resolves unified canonical discovery');
requireText(core, "import('../execution/canonical-execution-scheduler.js')", 'core runtime lazily resolves canonical scheduler');
forbidText(core, "from '../execution/canonical-execution-scheduler.js'", 'core runtime must not create a static execution/governance/telemetry import cycle');
requireText(core, 'createCryptoCrawlerCoreLifecycle', 'core runtime delegates lifecycle state to one idempotent coordinator');
requireText(lifecycle, 'dependencies.startDiscovery();', 'core lifecycle starts canonical discovery singleton');
requireText(lifecycle, 'dependencies.startScheduler();', 'core lifecycle starts canonical scheduler singleton');
requireText(lifecycle, 'dependencies.stopScheduler();', 'core lifecycle stops scheduler before discovery');
requireText(lifecycle, 'dependencies.stopDiscovery();', 'core lifecycle stops canonical discovery singleton');

requireText(telemetry, 'const coreStart = ensureCryptoCrawlerCoreRuntime();', 'telemetry requests canonical core startup');
requireText(telemetry, 'await coreStart;', 'telemetry awaits canonical core before optional provider bootstrap');
requireText(telemetry, 'CRYPTOCRAWL_ALLOW_PUBLIC_ANKR_FALLBACK', 'anonymous public Ankr fallback requires explicit opt-in');
requireText(telemetry, 'admitAnkrFallback', 'telemetry uses RPC fallback admission policy');
forbidText(telemetry, 'multiTopologyDiscoveryController.start()', 'telemetry must not own a second discovery lifecycle');
forbidText(telemetry, 'canonicalExecutionScheduler.start()', 'telemetry must not own scheduler startup');

const coreStartIndex = telemetry.indexOf('await coreStart;');
const rpcStartIndex = telemetry.indexOf('await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);');
if (coreStartIndex < 0 || rpcStartIndex < 0 || coreStartIndex >= rpcStartIndex) {
  failures.push('canonical CEX core must start before optional shared RPC/provider telemetry');
}

forbidText(faucetWiring, 'canonicalExecutionScheduler.start()', 'faucet compatibility wiring must not own scheduler startup');
requireText(faucetWiring, "lifecycleOwner: 'CryptoCoreRuntime'", 'faucet wiring declares bounded core scheduler lifecycle coordinator');

requireText(rpcFallbackPolicy, 'allowAnonymousPublicFallback', 'RPC fallback policy receives explicit public-fallback permission');
requireText(rpcFallbackPolicy, 'if (!input.allowAnonymousPublicFallback || !publicUrl) return null;', 'anonymous public RPC fallback fails closed by default');
requireText(rpcFallbackPolicy, "provenance: 'configured'", 'configured RPC fallback retains provenance');
requireText(rpcFallbackPolicy, "provenance: 'explicit_public_fallback'", 'public RPC fallback retains explicit opt-in provenance');

if (failures.length) {
  console.error('[verify-core-topology-wiring] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-core-topology-wiring] PASS');
console.log(' - canonical discovery and scheduler resolve to the unified singleton authorities');
console.log(' - core startup precedes optional RPC/Alchemy/0x telemetry');
console.log(' - telemetry and faucet compatibility code cannot start competing lifecycles');
console.log(' - anonymous public Ankr fallback is opt-in');