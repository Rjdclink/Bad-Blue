const fs = require('node:fs');
const trace = fs.readFileSync('server/services/cryptocrawl/execution/maker-lifecycle-trace.ts', 'utf8');
const adapters = fs.readFileSync('server/services/cryptocrawl/execution/post-only-maker-adapters.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
function must(source, needle, label) { if (!source.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`); }
function mustNot(source, needle, label) { if (source.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`); }
must(trace, 'WeakMap<object, string>', 'one trace per plan object');
must(trace, 'randomUUID()', 'unique trace identity');
must(adapters, 'getMakerLifecycleTraceId(plan)', 'adapter trace reuse');
must(adapters, 'traceId: input.traceId', 'latency correlation field');
must(wiring, 'getMakerLifecycleTraceId(plan)', 'execution trace reuse');
must(wiring, "'[StablecoinMaker] Maker lifecycle terminal result'", 'terminal lifecycle record');
must(wiring, "'[StablecoinMaker] Maker lifecycle terminal error'", 'terminal failure record');
must(wiring, 'if (!isStablecoinMakerPlan(plan)) return originalExecute(plan);', 'taker path unchanged');
mustNot(trace, 'process.env', 'trace cannot contain credentials');
mustNot(adapters, "ordType: 'ioc'", 'no taker fallback introduced');
console.log('PASS maker lifecycle correlation tracing');
