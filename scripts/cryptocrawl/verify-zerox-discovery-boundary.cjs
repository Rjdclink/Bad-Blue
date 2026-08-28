const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const policy = read('server/services/cryptocrawl/intelligence/zerox-request-policy.ts');
const marketData = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const discovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');

requireText(policy, "purpose === 'execution' ? 'execution' : 'discovery'", '0x requests default to discovery authority');
requireText(policy, "endpoint: 'price'", '0x discovery policy uses /price');
requireText(policy, 'includeTaker: false', '0x discovery policy never includes taker');
requireText(policy, "endpoint: 'quote'", '0x quote endpoint remains available only for explicit execution purpose');
requireText(policy, 'execution quote requires a valid EVM taker address', '0x execution quote requires valid taker identity');

requireText(marketData, 'resolveZeroXRequestPolicy', '0x provider consumes request-purpose authority');
requireText(marketData, '${policy.endpoint}', '0x HTTP endpoint is selected by request-purpose policy');
requireText(marketData, "transaction: policy.endpoint === 'quote'", 'transaction payloads are parsed only for execution quotes');
requireText(marketData, "executable: policy.endpoint === 'quote'", 'executable evidence requires quote semantics');

requireText(discovery, "purpose: 'discovery'", 'DEX discovery explicitly requests 0x discovery semantics');
requireText(discovery, "quote.quoteKind === 'price'", 'DEX discovery accepts price evidence only');
requireText(discovery, 'quote.executable === false', 'DEX discovery rejects executable 0x evidence');
requireText(discovery, 'quote.transaction === undefined', 'DEX discovery rejects transaction payloads');
requireText(discovery, 'executableCapability: false', '0x round-trip discovery remains non-executable');
requireText(discovery, 'atomic_0x_roundtrip_execution_adapter', 'missing atomic 0x adapter remains explicit');
requireText(discovery, '0x:price_only_discovery', 'price-only 0x provenance is explicit');
forbidText(discovery, 'ZEROX_TAKER_ADDRESS', 'discovery cannot inherit an environment taker into provider requests');
forbidText(discovery, "purpose: 'execution'", 'discovery cannot request execution quote semantics');

if (failures.length > 0) {
  console.error('[zerox-discovery-boundary] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[zerox-discovery-boundary] PASS — measured 0x discovery is /price-only, taker-free, non-executable, and execution /quote remains separately gated');
