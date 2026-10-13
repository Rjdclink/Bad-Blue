'use strict';
// All I/O is mocked. Never loads the application, credentials, a wallet, or a server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const ethers = require('ethers');
const root = 'server/services/cryptocrawl/';
const log = { info() {}, debug() {}, warn() {}, error() {} };
let checks = 0;
const never = () => new Promise(() => {});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function load(file, mocks = {}, names = []) {
  const code = esbuild.transformSync(fs.readFileSync(root + file, 'utf8') + `\nexport { ${names.join(',')} };`, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const mod = { exports: {} };
  Function('require', 'module', 'exports', code)(name => {
    if (name.startsWith('node:')) return require(name);
    if (name === 'ethers') return ethers;
    if (name.endsWith('logger.js')) return log;
    if (name.endsWith('discovery-work-context.js')) return scope;
    return mocks[name] ?? {};
  }, mod, mod.exports);
  return mod.exports;
}
let scope = {};
scope = load('runtime/discovery-work-context.ts');
const { MultiProviderRpcManager } = load('api/blockchain-providers.ts');
async function check(name, work) { await work(); checks++; console.log(`PASS ${name}`); }
async function manager() {
  const counters = new Map();
  const instance = new MultiProviderRpcManager({
    discoverConfiguredProviders: false, operationTimeoutMs: 50, cooldownMs: 1,
    httpProviderFactory: url => ({
      async getNetwork() { counters.set(url, (counters.get(url) ?? 0) + 1); return { chainId: 1 }; },
      async getBlockNumber() { return 100; }, removeAllListeners() {}, url,
    }),
  });
  for (const [provider, priority] of [['first', 10], ['second', 5]]) await instance.registerProvider({ chain: 'ethereum', provider, priority, httpUrl: `http://${provider}`, capabilities: ['blocks', 'gas', 'contract_calls'] });
  return { instance, counters };
}
const funding = { chain: 'ethereum', mode: 'unavailable', nativeBalance: 0n, reserveFloor: 0n, paymentSource: 'unavailable', strictZeroInitialCapitalEligible: false, operatorMonetaryInputRequired: true, reason: 'test observation only' };
function opportunity(id = 'configured') { return { id, chain: 'ethereum', timestamp: Date.now(), expiresAt: Date.now() + 3000, flashLoanAmount: 1000000n, grossProfit: 500n, expectedProfit: -500n, estimatedGasCostInInputToken: 1000n, estimatedExecutionCostInInputToken: 1000n, flashLoanFeeInInputToken: 0n, relayFeeInInputToken: 0n, netProfitBps: -5, inputAssetSymbol: 'USDC', inputTokenDecimals: 6, route: [] }; }
function canonical(options = {}) {
  const recorded = [], rescued = [], repriced = [];
  const runtime = {
    initialize: options.initialize ?? (async () => {}), configuredRoutes: [],
    providers: new Map([['ethereum', {}]]), executionWallets: new Map(), dynamicChainConfigs: new Map(),
    receiverManager: options.receiverManager ?? { getReceiver: () => null },
    scanChain: options.scan ?? (async () => [opportunity()]),
    fromQuotedRoute(q) { assert.equal(this, runtime); return { ...opportunity(q.id), timestamp: q.observedAt, expiresAt: q.expiresAt }; },
  };
  const power = load('runtime/manual-power-state.ts');
  power.setCryptoCrawlerManualPowerPhase('STARTING');
  const result = load('discovery/zero-capital-canonical-discovery.ts', {
    '../runtime/manual-power-state.js': power,
    '../core/zero-capital-engine.js': { zeroCapitalEngine: runtime },
    './dynamic-zero-capital-routes.js': { discoverDynamicZeroCapitalQuotes: options.dynamic ?? (async () => []) },
    './measured-candidate-registry.js': { measuredCandidateRegistry: { get() {}, record(v) { recorded.push(v); } } },
    './stage-one-candidate-policy.js': { clearsStageOneCandidateOutputFloor: o => o.netProfitBps > -10, STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS: -10 },
    './zero-capital-route-authority.js': { getCanonicalZeroCapitalRoutes: () => options.routes ?? [] },
    '../execution/adapters/onchain-route-quoter.js': { zeroCapitalDiscoveryFloorBps: () => -100, stopZeroCapitalQuoteTracking() {} },
    '../runtime/system-owned-gas-funding-proof-wiring.js': { getProvenZeroCapitalGasFundingDecision: options.funding ?? (async () => funding) },
    '../execution/adapters/sponsored-receiver-manager.js': { supportsSponsoredReceiverChain: () => true },
    '../optimization/zero-capital-route-evidence-registry.js': { zeroCapitalRouteEvidenceRegistry: { record() {} } },
    '../integration/ape-directional-market.js': { selectApeStageOneHotSet: x => x },
    '../integration/zero-capital-profitability-rescue-fair.js': { runFairZeroCapitalProfitabilityRescue: async input => { rescued.push(...input.opportunities); return options.rescue ? options.rescue(input) : input.opportunities; } },
    '../integration/stage-two-zero-capital-bps-reduction.js': { runStageTwoZeroCapitalBpsReduction: options.reduce ?? (async input => input.opportunities) },
    '../integration/zero-capital-flash-provider-wiring.js': { repriceZeroCapitalProviderEconomics: async input => { repriced.push(...input.opportunities); return []; } },
    '../integration/zero-capital-alternative-capital-wiring.js': { repriceZeroCapitalAlternativeCapital: async () => [] },
  }, ['cycle']);
  return { ...result, recorded, rescued, repriced, runtime };
}
async function main() {
  process.env.NO_INTERVALS = 'true';
  await check('below-floor measurements reach the reducer before unchanged Stage One admission', async () => {
    let reductions = 0;
    const raw = { ...opportunity(), netProfitBps: -15, expectedProfit: -1500n };
    const c = canonical({ scan: async () => [raw], reduce: async input => {
      reductions++; assert.equal(input.opportunities[0], raw);
      return [{ ...raw, expectedProfit: -500n, netProfitBps: -5 }];
    } });
    await c.startCanonicalZeroCapitalDiscovery();
    for (let i = 0; i < 8; i++) await tick();
    assert.equal(reductions, 1); assert.equal(c.rescued[0].netProfitBps, -5);
    c.stopCanonicalZeroCapitalDiscovery();
  });
  await check('ready candidates do not wait for below-floor reduction', async () => {
    const gate = deferred();
    const c = canonical({ scan: async () => [opportunity('ready'), { ...opportunity('below'), netProfitBps: -15 }], reduce: () => gate.promise });
    await c.startCanonicalZeroCapitalDiscovery();
    for (let i = 0; i < 8; i++) await tick();
    assert.equal(c.rescued.length, 1); assert.equal(c.rescued[0].id, 'ready');
    c.stopCanonicalZeroCapitalDiscovery(); gate.resolve([{ ...opportunity('below'), netProfitBps: 5 }]); await tick();
    assert.equal(c.rescued.length, 1);
  });
  await check('healthy RPC does not wait for a degraded peer recovery probe', async () => {
    const { instance, counters } = await manager();
    const first = instance.candidates.get('ethereum')[0];
    first.state = 'degraded'; first.httpProvider.getNetwork = never;
    const result = await instance.execute('ethereum', 'blocks', p => p.getBlockNumber());
    assert.equal(result.provenance.provider, 'second');
    assert.equal(counters.get('http://first'), 1);
    await instance.destroy();
  });
  await check('parallel read returns healthy fallback while first provider is hung', async () => {
    const { instance } = await manager(); let calls = 0;
    const result = await instance.executeRead('ethereum', 'contract_calls', p => { calls++; return p.url.endsWith('first') ? never() : Promise.resolve(42); }, 40);
    assert.equal(result.result, 42); assert.equal(result.provenance.provider, 'second'); assert.equal(calls, 2);
    await instance.destroy();
  });
  await check('fast primary read cancels the unused hedge without a second call', async () => {
    const { instance } = await manager(); let calls = 0;
    await instance.executeRead('ethereum', 'blocks', async () => { calls++; return 100; }, 100);
    await new Promise(r => setTimeout(r, 35)); assert.equal(calls, 1); await instance.destroy();
  });
  await check('timed-out read cannot start delayed retries or mark aborted requests healthy', async () => {
    const { instance } = await manager(); let calls = 0;
    await assert.rejects(instance.executeRead('ethereum', 'contract_calls', () => { calls++; return never(); }, 8), /deadline exceeded/);
    const callsAtDeadline = calls;
    assert.ok(callsAtDeadline >= 1 && callsAtDeadline <= 2);
    await new Promise(r => setTimeout(r, 65)); assert.equal(calls, callsAtDeadline);
    await instance.destroy();
  });
  await check('concurrent all-unhealthy requests share recovery probes', async () => {
    const { instance, counters } = await manager();
    for (const c of instance.candidates.get('ethereum')) c.state = 'degraded';
    await Promise.all(Array.from({ length: 12 }, () => instance.execute('ethereum', 'blocks', p => p.getBlockNumber())));
    assert.equal(counters.get('http://first'), 2); assert.equal(counters.get('http://second'), 2);
    await instance.destroy();
  });
  await check('stopping an in-flight provider call prevents its next call', async () => {
    const abort = new AbortController(); const gate = deferred(); let calls = 0;
    const provider = scope.discoveryProvider({ async getBlockNumber() { calls++; return gate.promise; }, async getFeeData() { calls++; return {}; } });
    const work = scope.runDiscoveryWork('stop test', 100, async () => { await provider.getBlockNumber(); await provider.getFeeData(); }, abort.signal);
    await tick(); abort.abort(); await assert.rejects(work, /cancelled/); gate.resolve(1); await tick();
    assert.equal(calls, 1);
  });
  await check('configured quote enters BPS rescue before slow dynamic scan settles', async () => {
    const gate = deferred(); const c = canonical({ dynamic: () => gate.promise });
    const startup = c.startCanonicalZeroCapitalDiscovery();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(c.recorded.length, 1); assert.equal(c.rescued.length, 1); assert.equal(c.repriced.length, 1);
    c.stopCanonicalZeroCapitalDiscovery(); gate.resolve([]); await startup;
    assert.equal(c.getCanonicalZeroCapitalDiscoverySnapshot().started, false);
  });
  await check('dynamic quote enters rescue when configured route scan is hung', async () => {
    const c = canonical({ scan: never, dynamic: async (_chain, _provider, _funding, accept) => { const q = opportunity('dynamic'); await accept([q]); return [q]; } });
    const startup = c.startCanonicalZeroCapitalDiscovery(); for (let i = 0; i < 5; i++) await tick();
    assert.equal(c.rescued[0].id, 'dynamic'); c.stopCanonicalZeroCapitalDiscovery(); await startup;
  });
  await check('healthy chain scans again while another chain remains hung', async () => {
    const c = canonical({ scan: async chain => chain === 'ethereum' ? never() : [opportunity('healthy')] });
    c.runtime.providers.set('polygon', {});
    await c.startCanonicalZeroCapitalDiscovery(); for (let i = 0; i < 8; i++) await tick();
    const before = c.recorded.length; assert.equal(before, 1);
    await c.cycle(); for (let i = 0; i < 8; i++) await tick();
    assert.equal(c.recorded.length, before + 1); c.stopCanonicalZeroCapitalDiscovery();
  });
  await check('no late candidate publication after Stop, including a pending configured scan', async () => {
    const gate = deferred(); const c = canonical({ scan: () => gate.promise }); const startup = c.startCanonicalZeroCapitalDiscovery();
    await tick(); c.stopCanonicalZeroCapitalDiscovery(); gate.resolve([opportunity()]); await startup; await tick();
    assert.equal(c.recorded.length, 0); assert.equal(c.rescued.length, 0);
  });
  await check('expired rescue output cannot proceed to provider repricing', async () => {
    const c = canonical({ rescue: async input => input.opportunities.map(o => ({ ...o, expiresAt: Date.now() - 1 })) });
    await c.startCanonicalZeroCapitalDiscovery(); for (let i = 0; i < 8; i++) await tick(); assert.equal(c.rescued.length, 1); assert.equal(c.repriced.length, 0); c.stopCanonicalZeroCapitalDiscovery();
  });
  await check('Stop during initialization cannot resurrect discovery', async () => {
    const gate = deferred(); const c = canonical({ initialize: () => gate.promise });
    const startup = c.startCanonicalZeroCapitalDiscovery(); c.stopCanonicalZeroCapitalDiscovery(); gate.resolve(); await assert.rejects(startup, /cancelled/);
    assert.equal(c.getCanonicalZeroCapitalDiscoverySnapshot().started, false); assert.equal(c.recorded.length, 0);
  });
  await check('Stop aborts a sponsor read and prevents any subsequent sponsor request', async () => {
    const power = load('runtime/manual-power-state.ts');
    power.setCryptoCrawlerManualPowerPhase('STARTING');
    const { PimlicoGasSponsorshipManager } = load('strategies/gas-sponsorship.ts', {'../runtime/manual-power-state.js': power});
    const sponsor = new PimlicoGasSponsorshipManager({ APE_PIMLICO_API_KEY: 'test-only' });
    const controller = new AbortController(); let calls = 0, aborted = false; const savedFetch = global.fetch;
    global.fetch = (_url, options) => { calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, { once: true })); };
    try {
      const request = scope.runDiscoveryWork('sponsor test', 100, () => sponsor.rpc(1, 'eth_chainId', []), controller.signal);
      await tick(); controller.abort(); await assert.rejects(request); await tick();
      assert.equal(aborted, true);
      await assert.rejects(scope.withDiscoverySignal(controller.signal, () => sponsor.rpc(1, 'eth_chainId', [])));
      assert.equal(calls, 1);
    } finally { global.fetch = savedFetch; }
  });
  await check('late funding proof cannot start a wallet RPC after its deadline', async () => {
    const gate = deferred(); let balances = 0;
    const proof = load('runtime/system-owned-gas-funding-proof-wiring.ts', {
      '../capital-free/dynamic-gas-funding-engine.js': { chooseGasFundingMode: () => ({ ...funding, reserveFloor: 1n }) },
      '../execution/system-native-gas-spend-authority.js': { getSystemNativeGasAuthority: () => gate.promise },
    });
    const context = { providers: new Map([['ethereum', { getBalance: async () => { balances++; return ethers.BigNumber.from(100); } }]]), executionWallets: new Map([['ethereum', { address: 'test' }]]), dynamicChainConfigs: new Map([['ethereum', {}]]), gasSponsor: { getReadiness: () => ({ ready: false }) } };
    await assert.rejects(scope.runDiscoveryWork('funding test', 8, () => proof.getProvenZeroCapitalGasFundingDecision(context, 'ethereum')), /deadline exceeded/);
    gate.resolve({ spendableWei: '100' }); await tick(); assert.equal(balances, 0);
  });
  await check('receiver preparation is parallel and cannot issue permissions after Stop', async () => {
    const gate = deferred(); const entered = []; let permissions = 0;
    const c = canonical({ scan: async () => [], routes: [{ chain: 'ethereum' }, { chain: 'polygon' }],
      funding: async () => ({ ...funding, mode: 'sponsored', paymentSource: 'provider_sponsored', strictZeroInitialCapitalEligible: true, operatorMonetaryInputRequired: false }),
      receiverManager: {
        getReceiver: () => null,
        ensureReceiver: async ({ chain }) => { entered.push(chain); return gate.promise; },
        buildMissingPermissionCalls: async () => { permissions++; return []; },
        buildMissingCompositePermissionCalls: async () => [],
      },
    });
    c.runtime.providers.set('polygon', {}); c.runtime.executionWallets.set('ethereum', {}); c.runtime.executionWallets.set('polygon', {});
    await c.startCanonicalZeroCapitalDiscovery(); for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(entered.sort(), ['ethereum', 'polygon']); c.stopCanonicalZeroCapitalDiscovery();
    gate.resolve({ address: 'test' }); for (let i = 0; i < 5; i++) await tick(); assert.equal(permissions, 0);
  });
  await check('shared candidate publication rejects cancelled BPS continuations', async () => {
    const publication = load('discovery/candidate-publication-generation.ts');
    const controller = new AbortController(); controller.abort(new Error('stopped'));
    assert.throws(() => scope.withDiscoverySignal(controller.signal, () => publication.assertCurrentCandidatePublication('ZERO_CAPITAL_ATOMIC')), /stopped/);
  });
  await check('known dynamic routes reach rescue before token discovery completes', async () => {
    const gate = deferred(); const published = deferred(); let quoted = 0;
    const gas = load('discovery/configured-zero-capital-gas-economics.ts');
    const dynamic = load('discovery/dynamic-zero-capital-routes.ts', {
      '../bridge/chain-config.js': { DEFAULT_GAS_LIMIT: 21000, SUPPORTED_CHAINS: {} },
      './configured-zero-capital-gas-economics.js': gas,
      '../bridge/live-price-mesh.js': { livePriceMesh: { getLiveSymbolPrices: async symbols => new Map(symbols.map(s => [s, s === 'ETH' ? 2000 : 1])) } },
      './graphless-dex-scout.js': { discoverGraphlessDexTokens: () => gate.promise },
      './zero-capital-route-preselection.js': { selectZeroCapitalRoutesForQuote: routes => ({ selectedRoutes: routes.slice(0, 1), scores: [], quoteBudget: 1 }), recordZeroCapitalRouteQuoteCycle() {} },
      '../execution/adapters/onchain-route-quoter.js': { quoteConfiguredZeroCapitalRoutesForChain: async () => { quoted++; return [{ ...opportunity(), executablePositive: true, netProfit: 100n }]; } },
    });
    const provider = { getFeeData: async () => ({ gasPrice: ethers.BigNumber.from(1000000000) }) };
    const work = dynamic.discoverDynamicZeroCapitalQuotes('ethereum', provider, funding, async quotes => { assert.equal(quotes.length, 1); published.resolve(); });
    await published.promise; assert.equal(quoted, 1);
    gate.resolve({ candidates: [], sources: [] }); await work;
  });
  await check('block tracker has its own lifetime and stops its subscriptions', async () => {
    let unsubscribed = 0, callback;
    const quoter = load('execution/adapters/onchain-route-quoter.ts', {
      '../../api/blockchain-providers.js': { multiProviderRpcManager: {
        execute: async () => ({ result: 100 }),
        subscribe: async (_chain, _kind, cb) => { callback = cb; return { unsubscribe: async () => { unsubscribed++; } }; },
      } },
    }, ['ensureQuoteBlockTracker']);
    await scope.runDiscoveryWork('short quote', 100, async () => { quoter.ensureQuoteBlockTracker('ethereum'); await tick(); });
    callback(101); assert.equal(quoter.getZeroCapitalRpcReuseSnapshot().trackedBlocks.ethereum, 101);
    quoter.stopZeroCapitalQuoteTracking(); await tick(); assert.equal(unsubscribed, 1);
    callback(102); assert.deepEqual(quoter.getZeroCapitalRpcReuseSnapshot().trackedBlocks, {});
  });
  await check('quote batch and resident cache preserve original evidence lifetime', async () => {
    const quoter = load('execution/adapters/onchain-route-quoter.ts', {}, ['rememberResidentBestBpsQuote']);
    const q = { ...opportunity('q'), amountIn: 1000000n, netProfit: 600n, netProfitBps: 6, observedAt: Date.now() - 2900, expiresAt: Date.now() + 100, quoteLatencyMs: 10 };
    quoter.rememberResidentBestBpsQuote('q', [q]);
    assert.equal(quoter.peekResidentBestBpsQuoteEvidence('q').expiresAt, q.expiresAt);
    assert.equal(quoter.peekResidentExactQuoteEvidence('q', q.amountIn).observedAt, q.observedAt);
    assert.equal(quoter.peekResidentBestBpsQuoteEvidence('q', q.expiresAt + 1), null);
    quoter.stopZeroCapitalQuoteTracking();
  });
  console.log(`PASS ${checks} scan liveness behavior checks; all transport/transaction I/O mocked`);
}
// Keep a handle alive while intentionally testing unref'ed watchdog timers.
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
