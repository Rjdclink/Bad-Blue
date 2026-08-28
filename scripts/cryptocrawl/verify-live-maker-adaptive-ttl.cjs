const fs = require('node:fs');
const source = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
function must(needle, label) { if (!source.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`); }
function mustNot(needle, label) { if (source.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`); }
must('getMakerPaperProofStats', 'paper proof feedback');
must('terminal < 10', 'minimum sample floor');
must('Math.min(30_000', '30-second hard ceiling');
must('Math.max(3_000', 'adaptive TTL floor');
must("'paper_calibrated_bounded'", 'bounded calibration label');
must('settlementTimeoutMs: ttl.ttlMs', 'adaptive TTL reaches canonical settlement');
must('if (!isStablecoinMakerPlan(plan)) return originalExecute(plan);', 'taker path unchanged');
must('takerFallbackAllowed: false', 'no taker fallback telemetry');
mustNot('canExecuteTrades = true', 'no governance bypass');
console.log('PASS bounded paper-calibrated maker TTL wiring');
