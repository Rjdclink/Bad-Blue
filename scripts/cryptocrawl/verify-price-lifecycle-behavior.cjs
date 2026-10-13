'use strict';
// Real modules with transport and application dependencies mocked; no trading startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = 'server/services/cryptocrawl/';
const log = { info() {}, warn() {}, debug() {}, error() {} };
function load(file, mocks = {}, names = []) {
  const code = esbuild.transformSync(fs.readFileSync(root + file, 'utf8') + `\nexport {${names.join(',')}};`, {loader:'ts',format:'cjs',target:'es2022'}).code;
  const mod = {exports:{}};
  Function('require','module','exports',code)(name => mocks[name] ?? (name.startsWith('node:') ? require(name) : {}),mod,mod.exports);
  return mod.exports;
}
const tick = () => new Promise(r => setImmediate(r));
const delay = ms => new Promise(r => setTimeout(r,ms));
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
let checks=0;
async function check(name, f) { await f(); console.log('PASS '+name); checks++; }
async function main() {
  const originalFetch=global.fetch;
  const {fetchJsonWithRetry}=load('utils/resilient-http.ts');
  try {
    await check('response-body download remains covered by request timeout',async()=>{
      global.fetch=async(_url,{signal})=>({ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
      await assert.rejects(fetchJsonWithRetry('https://body.invalid',{timeoutMs:15,maxRetries:0}),/abort/i);
    });
    await check('pre-cancelled requests never send transport calls',async()=>{
      let calls=0;global.fetch=async()=>{calls++;};const c=new AbortController();c.abort(new Error('off'));
      await assert.rejects(fetchJsonWithRetry('https://pre.invalid',{init:{signal:c.signal}}),/off/);assert.equal(calls,0);
    });
    await check('OFF cancellation interrupts retry delay without another request',async()=>{
      let calls=0;global.fetch=async()=>{calls++;return {ok:false,status:429,headers:new Headers({'retry-after':'3600'}),body:{cancel:async()=>{}}};};
      const c=new AbortController();const work=fetchJsonWithRetry('https://retry.invalid',{init:{signal:c.signal},maxDelayMs:1000});
      await tick();c.abort(new Error('off'));await assert.rejects(work,/off/);assert.equal(calls,1);
    });
    await check('successful JSON is returned normally',async()=>{
      global.fetch=async()=>({ok:true,json:async()=>({price:123})});assert.deepEqual(await fetchJsonWithRetry('https://ok.invalid'),{price:123});
    });
  } finally {global.fetch=originalFetch;}
  function pricePlane(fetchEvidence) {
    const power=load('runtime/manual-power-state.ts');
    power.setCryptoCrawlerManualPowerPhase('STARTING');
    const mesh=load('bridge/live-price-mesh.ts',{
      './coingecko-client.js':{coinGeckoPriceClient:{getLiveSymbolPriceEvidence:fetchEvidence}},
      '../runtime/manual-power-state.js':power,
      '../core/zero-capital-price-evidence.js':load('core/zero-capital-price-evidence.ts'),
    }).livePriceMesh;
    clearInterval(mesh.residentPlaneTimer);mesh.hotSymbols=[];
    return {power,mesh};
  }
  await check('manual STARTING can collect prices needed to become ready',async()=>{
    const {power,mesh}=pricePlane(async()=>new Map([['ETH',{priceUsd:2000,observedAt:Date.now()}]]));
    assert.equal((await mesh.getLiveSymbolPrices(['ETH'])).get('ETH'),2000);power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('fresh resident evidence returns without waiting for a refresh',async()=>{
    const gate=deferred();const {power,mesh}=pricePlane(()=>gate.promise);
    mesh.publishResidentEvidence(new Map([['ETH',{priceUsd:2000,observedAt:Date.now()-4000}]]));
    const result=await Promise.race([mesh.getLiveSymbolPrices(['ETH']),delay(100).then(()=>{throw new Error('resident read blocked');})]);
    assert.equal(result.get('ETH'),2000);power.setCryptoCrawlerManualPowerPhase('OFF');gate.resolve(new Map());
  });
  await check('missing-symbol failure does not discard other fresh prices',async()=>{
    const {power,mesh}=pricePlane(async()=>{throw new Error('unavailable');});
    mesh.publishResidentEvidence(new Map([['USDC',{priceUsd:1,observedAt:Date.now()}]]));
    const prices=await mesh.getLiveSymbolPrices(['USDC','ETH']);assert.equal(prices.get('USDC'),1);assert.equal(prices.has('ETH'),false);power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('cached observation retains its original age',async()=>{
    const observedAt=Date.now()-2000;const {power,mesh}=pricePlane(async()=>new Map([['ETH',{priceUsd:2000,observedAt}]]));
    await mesh.getLiveSymbolPrices(['ETH']);assert.equal(mesh.peekLiveSymbolPriceEvidence('ETH').observedAt,observedAt);power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('OFF clears resident prices and old completions cannot repopulate after restart',async()=>{
    const gate=deferred();const {power,mesh}=pricePlane(()=>gate.promise);
    const work=mesh.getLiveSymbolPrices(['ETH']);await tick();power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');
    gate.resolve(new Map([['ETH',{priceUsd:2000,observedAt:Date.now()}]]));await work;assert.equal(mesh.peekLiveSymbolPriceEvidence('ETH'),null);power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('expired downloaded evidence cannot be restamped as fresh',async()=>{
    const {power,mesh}=pricePlane(async()=>new Map([['ETH',{priceUsd:2000,observedAt:Date.now()-6000}]]));
    assert.equal((await mesh.getLiveSymbolPrices(['ETH'])).size,0);power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('client cache preserves acquisition time across repeated reads',async()=>{
    const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');
    const client=load('bridge/coingecko-client.ts',{'../runtime/manual-power-state.js':power}).coinGeckoPriceClient;
    let calls=0;const observedAt=Date.now()-10;
    client.fetchLivePriceMesh=async()=>{calls++;return {pricesByCoinId:{ethereum:2000},canonicalProviderByCoinId:{ethereum:'defillama'},observedAt,executionEvidenceByCoinId:{ethereum:{priceUsd:2000,observedAt,acquiredAt:observedAt}}};};
    const a=await client.getLiveSymbolPriceEvidence(['ETH']);const b=await client.getLiveSymbolPriceEvidence(['ETH']);
    assert.equal(a.get('ETH').observedAt,b.get('ETH').observedAt);assert.equal(calls,1);power.setCryptoCrawlerManualPowerPhase('OFF');
    await assert.rejects(client.getLiveSymbolPrices(['ETH']),/MASTER_POWER_OFF/);
  });
  await check('upstream market timestamps exclude stale, future and undated prices',async()=>{
    const prices=load('bridge/coingecko-client.ts',{'../runtime/manual-power-state.js':load('runtime/manual-power-state.ts')});
    const now=Date.now();
    const request=[{coinId:'ethereum',key:'coingecko:ethereum'}];
    const normal=timestamp=>prices.normalizeDefiLlamaPrices({coins:{'coingecko:ethereum':{price:2000,timestamp}}},request);
    for(const timestamp of [undefined,(now-121000)/1000,(now+60000)/1000]) {
      assert.equal(Object.keys(prices.selectDatedPriceEvidence(['ethereum'],[{prices:normal(timestamp)}],now)).length,0);
    }
    const marketTime=now-60000;
    const selected=prices.selectDatedPriceEvidence(['ethereum'],[{prices:normal(marketTime/1000)},{prices:{ethereum:99999}}],now);
    assert.equal(selected.ethereum.observedAt,marketTime);assert.equal(selected.ethereum.priceUsd,2000);
    assert.equal(selected.ethereum.acquiredAt,now);
  });
  await check('fresh acquisition cannot renew an expired upstream market observation',async()=>{
    const now=Date.now();const {power,mesh}=pricePlane(async()=>new Map());
    mesh.publishResidentEvidence(new Map([['ETH',{priceUsd:2000,observedAt:now-121000,acquiredAt:now}]]));
    assert.equal(mesh.peekLiveSymbolPriceEvidence('ETH'),null);
    mesh.publishResidentEvidence(new Map([['ETH',{priceUsd:2000,observedAt:now-60000,acquiredAt:now}]]));
    assert.equal(mesh.peekLiveSymbolPriceEvidence('ETH').observedAt,now-60000);
    power.setCryptoCrawlerManualPowerPhase('OFF');
  });
  await check('price-provider transport aborts at OFF and sends no later calls',async()=>{
    const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');let calls=0;
    const client=load('bridge/coingecko-client.ts',{
      '../runtime/manual-power-state.js':power,
      '../utils/resilient-http':{fetchJsonWithRetry:async(_url,{init})=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}},
    }).coinGeckoPriceClient;
    const work=client.requestProviderJson('defillama','https://mock.invalid',{timeoutMs:100});await tick();power.setCryptoCrawlerManualPowerPhase('OFF');
    assert.equal(await work,null);assert.equal(await client.requestProviderJson('defillama','https://mock.invalid',{timeoutMs:100}),null);assert.equal(calls,1);
  });
  await check('actual below-floor reducer measures a negative-to-positive successor and reports it',async()=>{
    const scope=load('runtime/discovery-work-context.ts');
    const activity=load('integration/bps-activity.ts');
    let stale=false, profitable=true, calls=0;
    const now=Date.now();
    const source={id:'test-route',chain:'ethereum',timestamp:now,expiresAt:now+10000,inputToken:'0xabc',inputAssetSymbol:'USDC',inputTokenDecimals:6,inputAssetUsdPrice:1,flashLoanAmount:1000000n,expectedProfit:-1500n,grossProfit:-500n,estimatedGasCostInInputToken:1000n,estimatedExecutionCostInInputToken:1000n,relayFeeInInputToken:0n,netProfitBps:-15,quoteLatencyMs:1,confidence:1,route:[]};
    const route={id:source.id,chain:'ethereum',inputToken:source.inputToken,inputAssetSymbol:'USDC',inputTokenDecimals:6,estimatedGasCostInInputToken:'1000',relayFeeInInputToken:'0',legs:[]};
    const reducer=load('integration/stage-two-zero-capital-bps-reduction.ts',{
      '../../../logger.js':log,
      '../runtime/discovery-work-context.js':scope,
      './bps-activity.js':activity,
      '../discovery/measured-candidate-registry.js':{measuredCandidateRegistry:{get:()=>null}},
      '../optimization/zero-capital-route-evidence-registry.js':{zeroCapitalRouteEvidenceRegistry:{record(){}}},
      '../execution/adapters/flash-loan-provider-economics.js':{calculateMeasuredFlashLoanFee:()=>0n,measureFlashLoanProviders:async()=>[{observedAt:Date.now()+(stale?10000:0),executableEvidenceComplete:true,availableLiquidity:100000000n}]},
      '../execution/adapters/onchain-route-quoter.js':{quoteConfiguredZeroCapitalRoute:async r=>{
        calls++;const amount=BigInt(r.amountIn),net=profitable?amount*6n/10000n:-amount;
        return {id:r.id,chain:r.chain,amountIn:amount,netProfit:net,grossProfit:net+1000n,estimatedGasCostInInputToken:1000n,relayFeeInInputToken:0n,netProfitBps:profitable?6:-10000,quoteLatencyMs:1,observedAt:Date.now(),expiresAt:Date.now()+3000};
      }},
    });
    const input={chain:'ethereum',provider:{},opportunities:[source],configuredRoutes:[route],fromQuotedRoute:q=>({...source,flashLoanAmount:q.amountIn,expectedProfit:q.netProfit,grossProfit:q.grossProfit,netProfitBps:q.netProfitBps,timestamp:q.observedAt,expiresAt:q.expiresAt})};
    const result=await reducer.runStageTwoZeroCapitalBpsReduction(input);
    assert.ok(calls>0);assert.equal(result[0].netProfitBps,6);assert.equal(source.netProfitBps,-15);
    assert.equal(activity.getBpsActivitySnapshot().rows.at(-1).beforeBps,-15);assert.equal(activity.getBpsActivitySnapshot().rows.at(-1).afterBps,6);
    stale=true;const priorCalls=calls;assert.equal((await reducer.runStageTwoZeroCapitalBpsReduction(input))[0],source);assert.equal(calls,priorCalls);
    stale=false;profitable=false;assert.equal((await reducer.runStageTwoZeroCapitalBpsReduction(input))[0],source);
  });
  console.log(`PASS ${checks} price/HTTP lifecycle behavior checks; all I/O mocked`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
