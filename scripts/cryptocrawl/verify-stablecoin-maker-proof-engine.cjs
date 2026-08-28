const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`);
}
function mustNot(source, needle, label) {
  if (source.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`);
}

const proof = read('server/services/cryptocrawl/intelligence/maker-microstructure-proof.ts');
const maker = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
const discovery = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');

must(proof, 'microprice', 'microprice evidence');
must(proof, 'imbalance', 'queue imbalance evidence');
must(proof, 'adaptiveMakerTtlMs', 'adaptive maker TTL');
must(proof, "paperOnly: true", 'paper-only evidence contract');
must(proof, "authority: 'paper_evidence_only'", 'paper authority label');
must(proof, 'liveExecutionAuthority: false', 'no live execution authority');
must(proof, 'paperNetProfitUsd', 'paper P&L measurement');
must(proof, 'adverseSelectionBps', 'adverse selection measurement');
must(proof, 'paperFillLatencyMs', 'fill-latency measurement');

must(maker, "cexOrderBookStreams.getQuote", 'WebSocket-first maker books');
must(maker, "authority: 'websocket'", 'WebSocket authority');
must(maker, "authority: 'rest_fallback'", 'bounded REST fallback');
must(maker, "takerFallbackAllowed: false", 'no taker fallback');
must(maker, "feeAuthority: 'authenticated'", 'authenticated fee authority');
must(maker, "Math.min(5_000", 'canary hard ceiling');

must(discovery, 'observeMakerPaperProof', 'shadow proof wiring');
must(discovery, 'microprice_queue_imbalance_shadow_model', 'microstructure provenance');
must(discovery, 'adaptive_maker_ttl_shadow_model', 'adaptive TTL provenance');
must(discovery, 'paper_evidence_only:true', 'paper evidence provenance');
must(discovery, 'realized_profit_credit:false', 'no fake realized profit');
must(discovery, 'executableCapability: false', 'discovery cannot execute');
mustNot(discovery, 'canExecuteTrades = true', 'no governance bypass');

console.log('PASS stablecoin maker microstructure proof + WebSocket-first path');
