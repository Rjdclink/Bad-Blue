const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const cex = read('server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts');
const logger = read('server/logger.ts');
const worker = read('server/badblueWorker.ts');
const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const index = read('server/index.ts');

const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`[hyperscope-first3] missing ${label}: ${text}`);
};
const rejectText = (source, text, label) => {
  if (source.includes(text)) throw new Error(`[hyperscope-first3] forbidden ${label}: ${text}`);
};

// 1) Adaptive observation must remain one-shot and recursively rescheduled only
// after the prior observation settles, including failure paths.
requireText(cex, 'function scheduleNext', 'adaptive schedule authority');
requireText(cex, 'setTimeout(() =>', 'one-shot adaptive timer');
requireText(cex, 'observeFailClosed().finally(scheduleNext)', 'failure-resilient recursive rescheduling');

// 2) server/index.ts is the sole process lifecycle authority. Winston remains a
// transport and BadBlueWorker retains cleanup without independently owning exits.
requireText(index, "process.on('unhandledRejection'", 'central rejection authority');
requireText(index, "process.on('uncaughtException'", 'central exception authority');
requireText(index, "process.on('SIGTERM'", 'central SIGTERM authority');
requireText(index, "process.on('SIGINT'", 'central SIGINT authority');
requireText(index, 'await badblueWorker.shutdown()', 'central BadBlue cleanup call');
rejectText(logger, 'exceptionHandlers:', 'Winston exception authority');
rejectText(logger, 'rejectionHandlers:', 'Winston rejection authority');
rejectText(worker, 'this.registerShutdownHandlers();', 'BadBlue lifecycle registration');
rejectText(worker, 'private registerShutdownHandlers(', 'BadBlue lifecycle authority');
rejectText(worker, "process.on('SIGTERM'", 'BadBlue SIGTERM authority');
rejectText(worker, "process.on('SIGINT'", 'BadBlue SIGINT authority');
rejectText(worker, "process.on('uncaughtException'", 'BadBlue exception authority');
rejectText(worker, "process.on('unhandledRejection'", 'BadBlue rejection authority');
requireText(worker, 'async shutdown(): Promise<void>', 'BadBlue cleanup API');

// 3) Database routing is explicit per authority. CryptoCrawler proves Overflow
// readiness without mutating the shared node-postgres Pool prototype.
requireText(bootstrap, "process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false'", 'Overflow fail-closed default');
requireText(bootstrap, 'ensureCryptocrawlOverflowRuntimeSchema', 'Overflow schema readiness proof');
requireText(bootstrap, "process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'true'", 'Overflow ready state');
rejectText(bootstrap, 'Object.getPrototypeOf(pool)', 'global Pool prototype acquisition');
rejectText(bootstrap, 'prototype.connect', 'global Pool connect mutation');
rejectText(bootstrap, 'Pool.prototype.connect', 'direct Pool prototype mutation');
rejectText(bootstrap, 'cryptaraOverflowPrimaryGatewayConnect', 'global Primary interception wrapper');

console.log('[hyperscope-first3] PASS: adaptive scans reschedule after settlement/failure, server/index owns the sole process lifecycle, and CryptoCrawler database authority is explicit without global pg.Pool interception');
