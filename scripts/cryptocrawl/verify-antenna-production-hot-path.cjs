const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function requireText(text, needle, message) { assert.ok(text.includes(needle), message); }
function forbidText(text, needle, message) { assert.ok(!text.includes(needle), message); }

const types = read('server/services/computationalBeam/types.ts');
const antenna = read('server/services/computationalBeam/omniAntennaLayer.ts');
const router = read('server/services/computationalBeam/workloadRouter.ts');
const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
const quality = read('server/services/cryptocrawl/intelligence/sovereign-antenna-quality.ts');
const evolution = read('server/services/cryptocrawl/integration/order-book-evolution-wiring.ts');

for (const taskType of [
  'ORDER_BOOK_FRAME',
  'ORDER_BOOK_APPLY',
  'TRADE_STREAM',
  'STREAM_LIVENESS',
  'FRESHNESS_VALIDATION',
  'FEE_RESOLUTION',
]) {
  requireText(types, `${taskType} =`, `Antenna task contract must expose ${taskType}`);
}

requireText(antenna, 'simulatedExecution: false', 'Antenna may not advertise simulated execution');
requireText(antenna, 'fictionalRemoteCapacityAdvertised: false', 'Antenna may not advertise fictional remote capacity');
requireText(antenna, 'marketDataAuthority: false', 'Antenna must not own market-data truth');
requireText(antenna, 'executionAuthority: false', 'Antenna must not own execution authority');
requireText(antenna, "this.antennaNodes.set('local-antenna-1'", 'Antenna must advertise only real local/Railway runtime capacity by default');
requireText(antenna, 'registerTaskHandler', 'Antenna must support real registered hot-path handlers');
requireText(antenna, 'executeHotPathSync', 'Antenna must expose ordered synchronous hot-path acceleration');
requireText(antenna, 'quantiParallelismGovernor.acquire', 'queued Antenna work must use the canonical Quanti parallelism authority');
requireText(antenna, 'AbortController', 'queued Antenna work must support cancellation');
requireText(antenna, 'monitorEventLoopDelay', 'Antenna must measure event-loop delay');
requireText(antenna, 'performance.eventLoopUtilization()', 'Antenna must measure event-loop utilization');
requireText(antenna, 'capacityFactor', 'Antenna auxiliary concurrency must adapt to measured event-loop pressure');
requireText(antenna, 'orderedHotPathThrottledByPressure: false', 'ordered market-data hot path may not be reordered or throttled by auxiliary pressure control');
requireText(antenna, 'p95Ms: percentile(stats.samples, 0.95)', 'Antenna must expose p95 hot-path latency');
requireText(antenna, 'p99Ms: percentile(stats.samples, 0.99)', 'Antenna must expose p99 hot-path latency');
forbidText(antenna, 'cloudflare-antenna-1', 'fictional Cloudflare Antenna node must remain removed until a real executor is connected');
forbidText(antenna, 'gcf-antenna-1', 'fictional GCF Antenna node must remain removed until a real executor is connected');
forbidText(antenna, 'Math.random()', 'Antenna health/execution may not use synthetic randomness');

requireText(router, 'const ANTENNA_HOT_TASKS = new Set<TaskType>', 'WorkloadRouter must explicitly classify latency-critical Antenna work');
requireText(router, 'const NON_REPLAYABLE_MARKET_TASKS = new Set<TaskType>', 'sequence-dependent market observations must be identified as non-replayable');
requireText(router, 'if (ANTENNA_HOT_TASKS.has(task.type)) return TaskIntensity.LIGHTWEIGHT', 'hot task semantics must override generic/default intensity');
requireText(router, 'if (ANTENNA_HOT_TASKS.has(task.type)) return ComputeLayer.ANTENNA', 'hot tasks must remain on Antenna unless an explicit required layer is supplied');
requireText(router, 'return omniAntennaLayer.cancelTask(taskId)', 'Antenna-routed work must support cancellation');
requireText(router, 'const nonReplayable = task ? NON_REPLAYABLE_MARKET_TASKS.has(task.type) : false', 'market-frame retry policy must detect stale/non-replayable observations');
requireText(router, "reacquisitionAuthority: nonReplayable ? 'canonical_market_stream_resnapshot' : null", 'failed non-replayable frames must return to canonical stream reacquisition rather than delayed replay');
requireText(router, 'maxRetries: NON_REPLAYABLE_MARKET_TASKS.has(type) ? 0 : this.MAX_RETRIES', 'new sequence-dependent tasks must be created without delayed generic retries');
requireText(router, 'executionAuthority: false', 'WorkloadRouter must remain compute-routing only');

requireText(stream, "import { omniAntennaLayer } from '../../computationalBeam/omniAntennaLayer.js'", 'canonical CEX stream must use the Antenna accelerator');
requireText(stream, 'TaskType.ORDER_BOOK_FRAME', 'WebSocket decode/parse must pass through Antenna hot path');
requireText(stream, 'TaskType.ORDER_BOOK_APPLY', 'ordered local-book application must pass through Antenna hot path');
requireText(stream, 'TaskType.STREAM_LIVENESS', 'stream liveness must pass through Antenna hot path');
requireText(stream, 'perMessageDeflate: false', 'market-data sockets must avoid compression overhead unless explicitly benchmarked otherwise');
requireText(stream, 'handshakeTimeout: 10_000', 'market-data socket handshakes must be bounded');
requireText(stream, 'maxPayload: MAX_WS_PAYLOAD_BYTES', 'market-data WebSocket payload size must be bounded');
requireText(stream, 'KRAKEN_BOOK_DEPTH = 25', 'Kraken local-book depth must match its subscribed depth');
requireText(stream, 'crc32Ascii', 'Kraken CRC32 integrity implementation must remain present');
requireText(stream, 'validateKrakenChecksum', 'Kraken checksum must be applied when exact payload values are available');
requireText(stream, 'this.truncate()', 'Kraken/local books must enforce bounded subscribed depth after updates');
requireText(stream, 'previousSequence !== this.lastSequence', 'OKX sequence continuity must reject gaps');
requireText(stream, "String(payload.code || '') === '64008'", 'OKX service-upgrade notice must trigger proactive reconnect');
requireText(stream, "raw === 'pong'", 'OKX ping/pong liveness must be reconciled');
requireText(stream, "payload.method === 'pong'", 'Kraken ping/pong liveness must be reconciled');
requireText(stream, "channel: 'heartbeats'", 'Coinbase heartbeat channel must protect feed liveness');
requireText(stream, "marketDataAuthority: 'cex_order_book_stream'", 'canonical CEX stream must explicitly remain market-data authority');
requireText(stream, 'antennaExecutionAuthority: false', 'Antenna stream acceleration must not gain execution authority');

requireText(quality, 'p95SourceAgeMs', 'Antenna provider quality must measure source quote age, not only local lookup time');
requireText(quality, 'sourceAgeIncludedInQuality: true', 'source-age quality accounting must remain explicit');
requireText(quality, 'executionAuthority: false', 'provider quality must remain advisory only');
requireText(evolution, 'sourceAgeMs: quote ? Math.max(0, receivedAt - quote.timestamp) : undefined', 'book observer must feed measured source age into Antenna quality');
requireText(evolution, 'allExecutableVenuesStillObservedSimultaneously: true', 'provider quality may never suppress an executable venue from observation');
requireText(evolution, 'executionAuthority: false', 'Antenna attention/evolution must remain non-executing');

for (const forbidden of [
  'executeVerifiedArbitragePlan',
  'centralizedExchangeExecutor',
  "requireAllowed('SUBMIT_ORDER'",
  'stageManager.canExecuteTrades',
]) {
  forbidText(antenna, forbidden, `Antenna must not acquire trading authority through ${forbidden}`);
  forbidText(router, forbidden, `WorkloadRouter must not acquire trading authority through ${forbidden}`);
  forbidText(stream, forbidden, `market-data stream must not acquire trading authority through ${forbidden}`);
}

console.log('[antenna-production-hot-path] PASS: Antenna is real measured transport/parse/sequence/freshness acceleration, Quanti-backed, pressure-aware and explicitly routed; stale market frames are reacquired instead of replayed, while canonical CEX stream remains sole market-data truth and execution authority remains elsewhere');
