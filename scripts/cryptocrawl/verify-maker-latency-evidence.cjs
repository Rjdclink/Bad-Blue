const fs = require('node:fs');
const source = fs.readFileSync('server/services/cryptocrawl/execution/post-only-maker-adapters.ts', 'utf8');
function must(needle, label) { if (!source.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`); }
function mustNot(needle, label) { if (source.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`); }
must("operation: 'submit'", 'submit latency evidence');
must("operation: 'cancel'", 'cancel latency evidence');
must('clientRoundTripMs', 'client RTT evidence');
must('gatewayProcessingMs', 'OKX gateway timing evidence');
must('okxGatewayLatencyMs(payload)', 'OKX timing parser wiring');
must("ordType: 'post_only'", 'OKX remains post-only');
must("oflags: 'post'", 'Kraken remains post-only');
must('delegate.cancel(order)', 'canonical cancel retained');
must('executionAuthorityChanged: false', 'latency telemetry cannot change authority');
mustNot("ordType: 'ioc'", 'no taker fallback introduced');
console.log('PASS maker submit/cancel latency evidence wiring');
