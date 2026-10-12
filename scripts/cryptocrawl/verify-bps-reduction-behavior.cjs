'use strict';
// Execute the real reducer code with in-memory dependencies only. No server,
// database, wallet, provider transport, interval, or transaction executor is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = 'server/services/cryptocrawl/';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function load(file, mocks = {}, privateNames = []) {
  const source = fs.readFileSync(root + file, 'utf8') + `\nexport { ${privateNames.join(',')} };`;
  const code = esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const mod = { exports: {} };
  const fakeImmediate = () => ({ unref() {} });
  Function('require', 'module', 'exports', 'setImmediate', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    // Unused imports cannot load application code. Calling an unstubbed dependency fails.
    return {};
  }, mod, mod.exports, fakeImmediate);
  return mod.exports;
}
const log = { info() {}, debug() {}, warn() {} };
const now = Date.now();
const source = {
  id: 'route-1700000000', chain: 'ethereum', inputToken: '0xabc', inputAssetSymbol: 'USDC', inputTokenDecimals: 6,
  flashLoanAmount: 1000000n, expectedProfit: -500n, grossProfit: 500n,
  estimatedExecutionCostInInputToken: 1000n, estimatedGasCostInInputToken: 1000n, relayFeeInInputToken: 0n,
  netProfitBps: -5, gasEstimate: 1n, quoteLatencyMs: 1, confidence: 1,
  timestamp: now - 10, expiresAt: now + 60000, route: [],
};
const route = { id: 'route', chain: 'ethereum', inputToken: '0xabc', inputAssetSymbol: 'USDC', inputTokenDecimals: 6,
  amountIn: '1000000', estimatedGasCostInInputToken: '1000', relayFeeInInputToken: '0', legs: [] };
function quote(amount, profit) {
  return { id: 'route', chain: 'ethereum', amountIn: amount, netProfit: profit,
    netProfitBps: Number(profit * 10000000000n / amount) / 1000000,
    grossProfit: profit + 1000n, estimatedGasCostInInputToken: 1000n, relayFeeInInputToken: 0n,
    executablePositive: profit > 0n, quoteLatencyMs: 1 };
}
const fromQuote = q => ({ ...source, flashLoanAmount: q.amountIn, expectedProfit: q.netProfit,
  netProfitBps: q.netProfitBps, grossProfit: q.grossProfit, expiresAt: now + 120000 });
const admission = load('integration/ape-measured-opportunity-admission.ts', {
  '../discovery/measured-candidate-registry.js': { measuredCandidateRegistry: { get: () => null } },
  '../discovery/stage-one-candidate-policy.js': { clearsStageOneOutputFloorBps: x => x > -10 },
}, ['finite']);
check('unknown canonical economics stay unknown', () => {
  for (const v of [null, undefined, '', ' ', false, true, NaN, Infinity]) assert.equal(admission.finite(v), null);
  assert.equal(admission.finite(0), 0);
});
const activity = load('integration/bps-activity.ts');
let resident = null;
const atomic = load('integration/zero-capital-atomic-bps-engine.ts', {
  '../../../logger.js': log,
  './bps-activity.js': activity,
  '../execution/adapters/onchain-route-quoter.js': { peekResidentBestBpsQuoteEvidence: () => resident },
  '../execution/adapters/flash-loan-demand-hint.js': { resetFlashLoanDemandHints() {}, observeFlashLoanDemandHint() {} },
  './atomic-profitability-resident-routing.js': { hasApeResidentPlacement: () => true, orderApeResidentOpportunities: x => [...x], getApeResidentPlacement: () => null },
  './ape-measured-opportunity-admission.js': { ...admission, isApeMeasuredAdmitted: () => true, summarizeApeMeasuredAdmission: () => ({}) },
});
check('resident negative-to-positive overlay respects evidence TTL and reranks winners', () => {
  resident = { quote: quote(1000000n, 600n), observedAt: now - 10, expiresAt: Date.now() + 5000 };
  const incumbent = { ...source, id: 'other', expectedProfit: 200n, netProfitBps: 2 };
  const result = atomic.runZeroCapitalAtomicBpsEngine({ chain: 'ethereum', opportunities: [incumbent, source], configuredRoutes: [route], fromQuotedRoute: fromQuote });
  assert.equal(result[0].id, source.id);
  assert.equal(result[0].netProfitBps, 6);
  assert.equal(result[0].expiresAt, resident.expiresAt);
  assert.equal(source.netProfitBps, -5);
  assert.equal(result[1], incumbent);
});
check('expired resident evidence cannot become positive overlay', () => {
  resident.expiresAt = now - 1;
  const result = atomic.runZeroCapitalAtomicBpsEngine({ chain: 'ethereum', opportunities: [source], configuredRoutes: [route], fromQuotedRoute: fromQuote });
  assert.equal(result[0], source);
});
let networkQuotes = 0;
let feeObservedAt = now;
let residentExact = null;
let profitableQuotes = true;
let quoteModel = null;
let availableLiquidity = 10000000n;
const toolbox = load('integration/ape-profitability-toolbox.ts', {}, []);
const telemetry = { logicalRequests: 0, residentHits: 0, physicalMeasurementStarts: 0, singleflightJoins: 0 };
const v4 = load('integration/zero-capital-profitability-rescue-v4.ts', {
  '../../../logger.js': log,
  './bps-activity.js': activity,
  '../execution/adapters/flash-loan-provider-economics.js': {
    calculateMeasuredFlashLoanFee: () => 0n,
    getFlashLoanProviderMeasurementTelemetry: () => telemetry,
    measureFlashLoanProviders: async () => [{ provider: 'balancer_v2', observedAt: feeObservedAt, executableEvidenceComplete: true, availableLiquidity }],
  },
  '../execution/adapters/dual-flash-loan-provider-mesh.js': { selectMeasuredDualFlashLoanAllocation: () => null, selectMeasuredProviderPairAllocation: () => null },
  '../execution/adapters/onchain-route-quoter.js': {
    peekResidentExactQuoteEvidence: () => residentExact,
    quoteConfiguredZeroCapitalRoute: async r => {
      networkQuotes++;
      const amount = BigInt(r.amountIn);
      if (quoteModel) return quoteModel(amount);
      // A small quote earns +6 BPS; the larger-dollar result earns only +2 BPS.
      return quote(amount, profitableQuotes ? (amount <= 1000000n ? amount * 6n / 10000n : amount * 2n / 10000n) : -amount / 1000n);
    },
  },
  './ape-profitability-toolbox.js': { ...toolbox, buildApeProfitabilityToolboxPlan: () => null },
  './ape-hypergraph-intelligence.js': { buildApeDefectVector: () => ({ structuralEdgeDefect: false }), recordApeRouteOutcome() {}, selectPersistentRouteFrontier: ({ routes }) => routes },
  './zero-capital-profit-output-floor.js': { ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD: Number.MIN_VALUE },
}, ['quoteBetter', 'strictImprovement', 'providerFresh', 'alignRouteCostBasisToStageOne']);
check('V4 uses exact BPS rather than absolute profit', () => {
  const highBps = quote(1000000n, 600n);
  const highDollars = quote(10000000n, 2000n);
  assert.equal(v4.quoteBetter(highBps, highDollars), highBps);
  assert.equal(v4.quoteBetter(highDollars, highBps), highBps);
  const original = { ...source, expectedProfit: 600n, netProfitBps: 6 };
  assert.equal(v4.strictImprovement(original, highDollars), false);
  assert.equal(v4.strictImprovement(original, quote(500000n, 400n)), true);
});
check('sub-display-precision signed improvements survive comparison', () => {
  const amount = 10n ** 24n;
  const before = { ...source, flashLoanAmount: amount, expectedProfit: -1n, netProfitBps: 0 };
  assert.equal(v4.strictImprovement(before, quote(amount, 1n)), true);
  assert.equal(v4.quoteBetter(quote(amount, -1n), quote(amount, 1n)).netProfit, 1n);
});
check('future or stale provider observations cannot lower measured costs', () => {
  for (const observedAt of [now + 1, now - 6000, NaN, Infinity, 0]) assert.equal(v4.providerFresh({ executableEvidenceComplete: true, observedAt }, now), false);
  assert.equal(v4.providerFresh({ executableEvidenceComplete: true, observedAt: now }, now), true);
});
const quoter = load('execution/adapters/onchain-route-quoter.ts', {}, ['bestBpsQuote']);
check('resident size search compares exact ratios despite equal displayed BPS', () => {
  const amount = 10n ** 24n;
  const lower = quote(amount * 10n, 2n);
  const higher = quote(amount, 1n);
  assert.equal(lower.netProfitBps, higher.netProfitBps);
  assert.equal(quoter.bestBpsQuote([lower, higher]), higher);
});
const superEngine = load('optimization/bps-reduction-super-engine.ts', {}, ['opportunityPlans', 'updateRealizedGovernor', 'tacticState']);
check('repeated settlement updates count once in BPS learning', () => {
  superEngine.opportunityPlans.set('settled', { predictedNetBps: 6, tacticKeys: ['resize'], realizedRecorded: false });
  const candidate = { opportunityId: 'settled', canonicalBps: { realizedNetBps: 5 } };
  superEngine.updateRealizedGovernor(candidate);
  superEngine.updateRealizedGovernor(candidate);
  assert.equal(superEngine.tacticState('resize').realizedSamples, 1);
});
const gasEconomics = load('discovery/configured-zero-capital-gas-economics.ts');
const bn = n => ({ gt: other => n > other, toString: () => String(n) });
check('native gas screen uses expected price before maximum fee ceiling', () => {
  assert.equal(gasEconomics.expectedExecutionGasPriceWei({ gasPrice: bn(12), maxFeePerGas: bn(100) }), 12n);
  assert.equal(gasEconomics.expectedExecutionGasPriceWei({ lastBaseFeePerGas: bn(10), maxPriorityFeePerGas: bn(2), maxFeePerGas: bn(100) }), 12n);
  assert.equal(gasEconomics.expectedExecutionGasPriceWei({}), 0n);
});
check('gas conversion values input tokens and rounds costs up', () => {
  assert.equal(gasEconomics.gasUsdToTokenBaseUnits(3, 0.5, 6), '6000000');
  assert.equal(gasEconomics.gasUsdToTokenBaseUnits(0.000001, 3, 6), '1');
  assert.throws(() => gasEconomics.gasUsdToTokenBaseUnits(3, NaN, 6));
});
check('alternative routes retain higher costs and zero templates cannot erase gas', () => {
  assert.equal(v4.alignRouteCostBasisToStageOne({ ...route, id: 'alternative', estimatedGasCostInInputToken: '3000' }, source).estimatedGasCostInInputToken, '3000');
  assert.equal(v4.alignRouteCostBasisToStageOne({ ...route, id: 'alternative', estimatedGasCostInInputToken: '0' }, source).estimatedGasCostInInputToken, '1000');
});
let tokenPrice = 0.5;
const dynamicGas = load('discovery/dynamic-zero-capital-routes.ts', {
  '../bridge/chain-config.js': { DEFAULT_GAS_LIMIT: 500000 },
  './configured-zero-capital-gas-economics.js': gasEconomics,
  '../bridge/live-price-mesh.js': { livePriceMesh: { getLiveSymbolPrices: async () => new Map([['ETH', 2000], ['USDC', tokenPrice]]) } },
  '../strategies/gas-sponsorship.js': { getGasSponsorManager: () => ({
    getGasPriceQuote: async () => ({ maxFeePerGasWei: 2000000000n }),
    getStageOneOverheadGasUnits: () => 100000,
    getBillingSurchargeBps: () => 1000,
  }) },
}, ['enrichMeasuredGasCost']);
async function main() {
  const gasProvider = { getFeeData: async () => ({ gasPrice: bn(1000000000), maxFeePerGas: bn(100000000000) }), getNetwork: async () => ({ chainId: 1 }) };
  const nativeGas = await dynamicGas.enrichMeasuredGasCost('ethereum', gasProvider, [route], 'native');
  const sponsoredGas = await dynamicGas.enrichMeasuredGasCost('ethereum', gasProvider, [route], 'sponsored');
  check('dynamic native and sponsored screens use distinct complete gas economics', () => {
    assert.equal(nativeGas.gasCostUsd, 3.5);
    assert.equal(nativeGas.routes[0].estimatedGasCostInInputToken, '7000000');
    assert.ok(Math.abs(sponsoredGas.gasCostUsd - 8.25) < 1e-9);
    assert.equal(sponsoredGas.gasCostAuthority, 'measured_sponsored_billing_proxy');
  });
  tokenPrice = NaN;
  await assert.rejects(dynamicGas.enrichMeasuredGasCost('ethereum', gasProvider, [route], 'native'), /Live input-token/);
  tokenPrice = 0.5;
  check('unknown token valuation cannot produce a gas-free positive quote', () => {});

  const stoppedAtFastPath = new Error('test boundary after bound callback');
  let boundCallbackResult;
  const gateway = load('integration/zero-capital-profitability-rescue-fair.ts', {
    '../core/zero-capital-engine.js': { zeroCapitalEngine: { expectedSlippageBps: () => 42 } },
    './atomic-profitability-resident-routing.js': { primeApeResidentRouting() {} },
    './zero-capital-atomic-bps-engine.js': { runZeroCapitalAtomicBpsEngine(input) {
      boundCallbackResult = input.fromQuotedRoute({}, 0);
      throw stoppedAtFastPath;
    } },
  });
  await assert.rejects(gateway.runFairZeroCapitalProfitabilityRescue({ opportunities: [],
    fromQuotedRoute() { return this.expectedSlippageBps(); },
  }), error => error === stoppedAtFastPath);
  check('gateway binds engine method before resident fast-path invocation', () => assert.equal(boundCallbackResult, 42));
  const input = { chain: 'ethereum', provider: {}, opportunities: [source], configuredRoutes: [route], fromQuotedRoute: fromQuote, maxRefinements: 1 };
  const out = await v4.runZeroCapitalProfitabilityRescueV4(input);
  check('active actuator requotes without advisory plan and recovers -5 to +6 BPS', () => {
    assert.ok(networkQuotes >= 2);
    assert.equal(out[0].netProfitBps, 6);
    assert.equal(source.netProfitBps, -5);
  });
  profitableQuotes = false;
  const negative = await v4.runZeroCapitalProfitabilityRescueV4(input);
  check('unprofitable measured quotes cannot manufacture positive BPS', () => assert.equal(negative[0], source));
  profitableQuotes = true;
  residentExact = { quote: quote(1000000n, 700n), observedAt: now, expiresAt: Date.now() + 5000 };
  const cached = await v4.runZeroCapitalProfitabilityRescueV4(input);
  check('V4 cached winner is bounded by resident evidence expiry', () => assert.equal(cached[0].expiresAt, residentExact.expiresAt));
  residentExact = null;
  feeObservedAt = Date.now() + 100000;
  const future = await v4.runZeroCapitalProfitabilityRescueV4(input);
  check('invalid provider economics prevent an actuator promotion', () => assert.equal(future[0], source));
  // Uniswap V2 constant-product arithmetic, using synthetic reserves, two 0.3%
  // pool fees, and a separately deducted $3 gas cost. No live market claims.
  // https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol
  const amountOut = (amount, reserveIn, reserveOut) => amount * 997n * reserveOut / (reserveIn * 1000n + amount * 997n);
  quoteModel = amount => {
    const eth = amountOut(amount, 10n ** 12n, 500n * 10n ** 18n);
    const usd = amountOut(eth, 500n * 10n ** 18n, 1012n * 10n ** 9n);
    const gross = usd - amount;
    return { ...quote(amount, gross - 3000000n), grossProfit: gross, estimatedGasCostInInputToken: 3000000n, flashLoanFeeInInputToken: 0n };
  };
  availableLiquidity = 100000000000n;
  feeObservedAt = Date.now();
  const measuredSeed = quoteModel(600000000n);
  const modelSource = { ...source, ...fromQuote(measuredSeed), estimatedGasCostInInputToken: 3000000n,
    relayFeeInInputToken: 0n, flashLoanFeeInInputToken: 0n, estimatedExecutionCostInInputToken: 3000000n };
  const beforeProfit = modelSource.expectedProfit;
  const probe = toolbox.buildApeCostDilutionProbe(modelSource, 80000000000n);
  const curveResult = await v4.runZeroCapitalProfitabilityRescueV4({ ...input, opportunities: [modelSource] });
  check('two-pool fee/impact/gas model improves negative net BPS past +5', () => {
    assert.ok(modelSource.netProfitBps < 0 && modelSource.netProfitBps > -10);
    assert.ok(curveResult[0].netProfitBps >= 5);
    assert.equal(curveResult[0].expectedProfit, quoteModel(curveResult[0].flashLoanAmount).netProfit);
    assert.equal(modelSource.expectedProfit, beforeProfit);
    assert.ok(probe > modelSource.flashLoanAmount);
    console.log(`  simulated pool result ${modelSource.netProfitBps} -> ${curveResult[0].netProfitBps} BPS`);
  });
  check('size hypothesis is bounded and cannot become credited profit', () => {
    assert.equal(toolbox.buildApeCostDilutionProbe(modelSource, 650000000n), 650000000n);
    assert.equal(toolbox.buildApeCostDilutionProbe({ ...source, grossProfit: 400n, flashLoanFeeInInputToken: 0n }, 10000000n), 2500001n);
    assert.equal(toolbox.buildApeCostDilutionProbe({ ...modelSource, grossProfit: -1n }, availableLiquidity), null);
    assert.equal(toolbox.buildApeCostDilutionProbe({ ...modelSource, estimatedGasCostInInputToken: undefined }, availableLiquidity), null);
    const amounts = toolbox.buildApeTargetAmounts({ intended: modelSource.flashLoanAmount, fundingCeiling: 80000000000n,
      providerCapacityBoundaries: [80000000000n], plan: null, opportunity: modelSource });
    assert.equal(amounts[0], modelSource.flashLoanAmount);
    assert.equal(amounts[1], probe);
  });
  quoteModel = null;
  const floor = load('integration/zero-capital-profit-output-floor.ts');
  check('+5 BPS is optional: smaller positive results remain eligible', () => {
    assert.equal(floor.clearsStrictPositiveOutputThreshold({ ...source, expectedProfit: 1n, netProfitBps: 0.01 }), true);
    assert.equal(floor.clearsStrictPositiveOutputThreshold({ ...source, expectedProfit: 0n, netProfitBps: 0 }), false);
  });
  const race = load('integration/atomic-bps-anytime-race.ts');
  let unhandled = 0;
  const onUnhandled = () => unhandled++;
  process.on('unhandledRejection', onUnhandled);
  await race.runAtomicBpsAnytimeRace({ tasks: [Promise.reject(new Error('late probe'))], deadlineAt: Date.now() - 1, acceptable: () => false, better: (_, c) => c });
  await new Promise(resolve => setTimeout(resolve, 10));
  process.off('unhandledRejection', onUnhandled);
  check('deadline-expired probes do not produce unhandled rejections', () => assert.equal(unhandled, 0));
  const result = await race.runAtomicBpsAnytimeRace({ tasks: [Promise.resolve(2), Promise.resolve(6)], deadlineAt: Date.now() + 100, acceptable: x => x > 0, better: (a, b) => Math.max(a ?? -Infinity, b) });
  check('already-arrived better BPS wins the anytime race', () => assert.equal(result.best, 6));
  check('terminal retains measured attempts with bounded immutable snapshots', () => {
    const isolated = load('integration/bps-activity.ts');
    for (let i = 0; i < 350; i++) isolated.recordBpsActivity(source, { profit: 600n, amount: 1000000n }, 'requote');
    const snapshot = isolated.getBpsActivitySnapshot();
    assert.equal(snapshot.rows.length, 300);
    assert.equal(snapshot.rows[0].sequence, 51);
    assert.equal(snapshot.rows[0].beforeBps, -5);
    assert.equal(snapshot.rows[0].afterBps, 6);
    assert.equal(snapshot.rows[0].asset, 'USDC');
    snapshot.rows[0].afterBps = 999;
    assert.equal(isolated.getBpsActivitySnapshot().rows[0].afterBps, 6);
  });
  console.log(`BPS behavior: ${checks} checks passed; all transports mocked; CryptoCrawler never started.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
