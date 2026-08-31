'use strict';
// Diagnostic isolation only. Do not merge this branch.
const { read, requirePattern, forbidPattern } = require('./lib/pr482-canonical-contract.cjs');
const timingGuard = read('server/services/cryptocrawl/integration/cross-venue-timing-guard-wiring.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
requirePattern(timingGuard, /supportedModes:\s*\['TT',\s*'MT',\s*'TM',\s*'MM'\]/, 'timing modes');
requirePattern(timingGuard, /makerExecution/, 'timing maker metadata');
requirePattern(canonicalRuntime, /coinbaseMakerExecutionAuthority:\s*true/, 'coinbase maker telemetry');
forbidPattern(canonicalRuntime, /kraken_okx_post_only/, 'stale maker narrowing');
console.log('[deployment-preflight][diagnostic] timing/runtime telemetry canonical assertions passed; continuing to downstream build');
