'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts', 'utf8');
const providerMesh = fs.readFileSync('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts', 'utf8');
const bridge = fs.readFileSync('server/services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.ts', 'utf8');
const policyPath = 'server/services/cryptocrawl/ghost-wallet/ghost-wallet-log-policy.ts';
const policySource = fs.readFileSync(policyPath, 'utf8');

function loadPureTypeScriptModule(sourceText, filename) {
  const compiled = ts.transpileModule(sourceText, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(row => row.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${filename} did not transpile cleanly`);
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', compiled.outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}

const policy = loadPureTypeScriptModule(policySource, policyPath);
assert.equal(policy.GHOST_WALLET_MAX_LOG_BLOCK_SPAN, 1_999);
assert.equal(policy.ghostWalletLogWindowEnd(100, 50_000), 2_098);
assert.equal(policy.ghostWalletLogWindowEnd(49_500, 50_000), 50_000);
assert.throws(() => policy.ghostWalletLogWindowEnd(10, 9), /GHOST_WALLET_LOG_WINDOW_INVALID/);
assert.equal(policy.ghostWalletDeploymentStateFromCodes(['0x'], 2), 'unverified');
assert.equal(policy.ghostWalletDeploymentStateFromCodes(['0x', '0x'], 3), 'undeployed');
assert.equal(policy.ghostWalletDeploymentStateFromCodes(['0x', '0x6000'], 3), 'deployed');

for (const rangeError of [
  new Error('query returned more than 10000 results'),
  { code: -32005, message: 'limit exceeded' },
  { error: { code: -32005, message: 'limit exceeded' } },
  { body: JSON.stringify({ error: { code: -32005, message: 'limit exceeded' } }) },
  { reason: 'maximum block range is 2000' },
]) {
  assert.equal(policy.isGhostWalletLogRangeLimitError(rangeError), true, `missed range error: ${JSON.stringify(rangeError)}`);
}
assert.equal(policy.isGhostWalletLogRangeLimitError(new Error('Archive requests require a personal token')), false);
assert.equal(policy.isGhostWalletArchiveUnavailableError(new Error('Archive requests require a personal token')), true);
assert.equal(policy.isGhostWalletThrottleError({ code: 429, message: 'Too Many Requests' }), true);
assert.equal(policy.isGhostWalletThrottleError({ code: -32005, message: 'limit exceeded' }), true);

for (const unsupportedBscUrl of [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed-public.bnbchain.org',
]) assert.equal(policy.ghostWalletProviderSupportsSettlementLogs('bsc', unsupportedBscUrl), false);
assert.equal(policy.ghostWalletProviderSupportsSettlementLogs('bsc', 'https://bsc-rpc.publicnode.com'), true);
assert.equal(policy.ghostWalletProviderSupportsSettlementLogs('bsc', 'https://bsc.drpc.org'), true);
assert.equal(policy.ghostWalletProviderSupportsSettlementLogs('ethereum', 'https://bsc-dataseed.bnbchain.org'), true);

for (const required of [
  'ghostWalletProviderMesh.getLogProviders(chain)',
  'latestBlockWithFailover',
  'querySettlementLogsWithFailover',
  'collectSettlementLogs',
  'failure.rangeLimited = sawRangeLimit',
  'failure.archiveUnavailable = sawArchiveUnavailable',
  'pending.unshift([fromBlock, midpoint], [midpoint + 1, toBlock])',
  'ghostWalletLogWindowEnd(fromBlock, latest)',
  'ghostWalletDeploymentStateFromCodes',
  'targetState.deployed.length === 0',
  'skippedUndeployedHistoricalScan: true',
  'persistentProgressPerChunk: true',
  'this.pendingBackfills.set(input.chain, input)',
  'logBackfillProviderFailover: true',
  'logBackfillAdaptiveRangeSplit: true',
  'for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log)',
]) {
  assert.ok(source.includes(required), `Ghost settlement log failover verifier missing: ${required}`);
}

assert.doesNotMatch(source, /input\.addresses\.map\(address => input\.provider\.getLogs/);
assert.doesNotMatch(source, /address:\s*input\.addresses/);
assert.match(source, /if \(!rangeLimited \|\| fromBlock >= toBlock\) throw error/);
assert.match(source, /await recordGhostWalletRuntimeState\(\{/);

const ingestIndex = source.indexOf('for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log)');
const cursorIndex = source.indexOf('reconciledBlock: toBlock', ingestIndex);
assert.ok(ingestIndex >= 0 && cursorIndex > ingestIndex, 'Durable reconciliation cursor must advance only after complete log ingestion');

assert.match(providerMesh, /bsc\.drpc\.org/);
assert.match(providerMesh, /ghostWalletProviderSupportsSettlementLogs/);
assert.match(providerMesh, /methodAwareSettlementLogSelection: true/);
assert.match(bridge, /ghostWalletProviderMesh\.getProviders\(chain\)/);
assert.match(bridge, /firstSuccessful/);
assert.match(bridge, /providerReadFailover: true/);
assert.match(source, /startupBackfillNonBlocking: true/);
assert.match(source, /retryBackfillWithoutPeriodicPolling: true/);
assert.match(source, /coalescedPushBackfillReplay: true/);

console.log('GHOST_SETTLEMENT_LOG_FAILOVER_VERIFIED');
