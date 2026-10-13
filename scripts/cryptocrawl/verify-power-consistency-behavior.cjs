'use strict';
// Isolated modules with mocked I/O: never boots the app or contacts a venue.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = 'server/services/cryptocrawl/';
const log = { info(){}, warn(){}, error(){}, debug(){} };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve}; };
function load(file, mocks={}, extra='') {
  const mod={exports:{}};
  const code=esbuild.transformSync((fs.readFileSync(root+file,'utf8')+extra).replace(/\bimport\(/g,'__import('), {loader:'ts',format:'cjs',target:'es2022'}).code;
  Function('require','module','exports','__import',code)(name => mocks[name] ?? (/^(node:|crypto$)/.test(name) ? require(name) : {}), mod,mod.exports,name=>Promise.resolve(mocks[name]??{}));
  return mod.exports;
}
let count=0;
async function check(name, fn){await fn(); count++; console.log('PASS '+name);}
function adminFixture({faucetGate, badStop=false}={}) {
  const power=load('runtime/manual-power-state.ts');
  const state={core:false,discovery:false,scheduler:false,faucet:false,engine:false,wiring:false};
  const stopped=[]; const routes={};
  const bridge=Object.fromEntries(['gasOracle','balanceMonitor','networkHealth'].map(name=>{
    let running=false;return [name,{start:async()=>{running=true;},stop(){stopped.push(name);running=false;},isRunning:()=>running}];
  }));
  const governance={requireAllowed(){},getState:()=>({stage:2})};
  const mocks={
    express:{Router:()=>({get:(path,fn)=>{routes[path]=fn;},post(){},use(){}})},
    '../runtime/manual-power-state.js':power,
    '../bridge':bridge,
    '../integration/master-pipeline':{pipeline:{run:async()=>{state.core=state.discovery=state.scheduler=true;},stop(){stopped.push('pipeline');state.core=state.discovery=state.scheduler=false;if(badStop)throw Error('pipeline stop failure');},isRunning:()=>state.scheduler,getMetrics:()=>({running:state.scheduler})}},
    '../discovery/zero-capital-canonical-discovery.js':{getCanonicalZeroCapitalDiscoverySnapshot:()=>({started:state.discovery})},
    '../runtime/core-runtime.js':{getCryptoCrawlerCoreRuntimeStatus:()=>({started:state.core})},
    '../discovery/multi-topology-discovery-controller.js':{multiTopologyDiscoveryController:{isRunning:()=>state.discovery}},
    '../core/zero-capital-engine':{zeroCapitalEngine:{start:async opts=>{state.engine=true;await opts.onInitialGasReady();},stop(){stopped.push('engine');state.engine=false;},getState:()=>({isRunning:state.engine,totalProfit:0n})}},
    '../faucet/autonomous-faucet.js':{autonomousFaucet:{runAutonomousLoop:async()=>{if(faucetGate)await faucetGate.promise;state.faucet=true;},stop(){stopped.push('faucet');state.faucet=false;},isActive:()=>state.faucet,getFaucetId:()=> 'fixture'}},
    '../integration/canonical-runtime-wiring.js':{activateCanonicalCryptoCrawlerRuntimeWiring(){state.wiring=true;},deactivateCanonicalCryptoCrawlerRuntimeWiring(){stopped.push('wiring');state.wiring=false;},getCanonicalCryptoCrawlerActivationState:()=>({activationAllowed:state.wiring,installed:state.wiring}),getCanonicalRuntimeComponentIsolationSnapshot:()=>({totalComponents:1,pendingComponents:0,degradedComponents:0}),waitForCanonicalRuntimeInstallation:async()=>{}},
    '../integration/telemetry-bootstrap.js':{ensureTelemetryBootstrap:async()=>{}},
    '../governance/index.js':{getCryptocrawlGovernance:()=>governance,initializeGovernance:async()=>{},resetGovernanceInitializationForManualStop(){}},
    '../governance/cryptara-integration.js':{cryptaraGovernance:{initialize:async()=>{},shutdown:async()=>{stopped.push('governance');}}},
    '../governance/stage-management.js':{stageManager:{isMarketOperationsAllowed:()=>true}},
    '../runtime/cryptocrawl-runtime-database.js':{reopenCryptocrawlRuntimeDatabasePools(){},closeCryptocrawlRuntimeDatabasePools:async()=>{stopped.push('database');},getCryptocrawlRuntimeDatabaseSnapshot:()=>({ordinary:{total:0},coordination:{total:0}})},
    '../integration/cryptara-supabase-hyper-bridge-bootstrap.js':{stopCryptaraHyperBridgeBootstrap(){stopped.push('bridge');},getCryptaraHyperBridgeBootstrapSnapshot:()=>({state:'idle',overflowWorker:{started:false}})},
    '../integration/cryptara-super-worker.js':{uninstallCryptaraSuperWorkerAdmission:async()=>{stopped.push('admission');},getCryptaraSuperWorkerSnapshot:()=>({admissionInstalled:false})},
    '../integration/cryptara-supabase-overflow-worker.js':{getCryptaraParallelProxySnapshot:()=>({pool:{total:0}})},
    '../../pantheonCrawlerOrchestrator.js':{notifyCryptocrawlerStarting:()=>true,notifyCryptocrawlerComplete(){},getSystemStatus:()=>({})},
  };
  return {api:load('api/admin-api.ts',mocks),power,state,stopped,routes};
}
async function main(){
  process.env.NODE_ENV='test'; process.env.ZERO_CAPITAL_ENABLE_EXECUTION='false';
  await check('core attempts both stops even if first throws and start never completed',()=>{
    const calls=[];const core=load('runtime/core-runtime-lifecycle.ts').createCryptoCrawlerCoreLifecycle({startDiscovery(){},startScheduler(){},stopScheduler(){calls.push('scheduler');throw Error('broken');},stopDiscovery(){calls.push('discovery');}});
    assert.throws(()=>core.stop(),/shutdown incomplete/);assert.deepEqual(calls,['scheduler','discovery']);
  });
  await check('master ON waits for the faucet; lost scheduler is reported DEGRADED',async()=>{
    const gate=deferred();const f=adminFixture({faucetGate:gate});
    const starting=f.api.startCryptoCrawlerRuntime();await tick();
    assert.equal(f.power.getCryptoCrawlerManualPowerPhase(),'STARTING');assert.equal(f.api.systemState.running,false);
    gate.resolve();assert.equal((await starting).success,true);assert.equal(f.power.getCryptoCrawlerManualPowerPhase(),'ON');
    f.state.scheduler=false;let snapshot;f.routes['/status']({}, {json:value=>{snapshot=value;}});
    assert.equal(snapshot.running,false);assert.equal(snapshot.lifecycle,'DEGRADED');assert(snapshot.readiness.missing.includes('scheduler'));
    assert.equal((await f.api.stopCryptoCrawlerRuntime()).stopped,true);
  });
  await check('sync stop failure cannot skip other workers, pools, or truthful fault status',async()=>{
    const f=adminFixture({badStop:true});const result=await f.api.stopCryptoCrawlerRuntime();
    for(const name of ['engine','faucet','gasOracle','balanceMonitor','networkHealth','wiring','governance','bridge','admission','database'])assert(f.stopped.includes(name),name);
    assert.equal(result.stopped,false);assert.equal(f.api.systemState.lifecycle,'DEGRADED');assert.equal(f.power.getCryptoCrawlerManualPowerPhase(),'OFF');
  });
  await check('stop during delayed startup cannot report ON after completion',async()=>{
    const gate=deferred();const f=adminFixture({faucetGate:gate});const starting=f.api.startCryptoCrawlerRuntime();await tick();
    f.power.setCryptoCrawlerManualPowerPhase('STOPPING');gate.resolve();
    assert.equal((await starting).success,false);assert.equal(f.power.getCryptoCrawlerManualPowerPhase(),'OFF');assert.equal(f.api.systemState.running,false);
  });
  await check('faucet coalesces startup and an old startup cannot revive after stop/restart',async()=>{
    const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');const gate=deferred();let starts=0;
    const Faucet=load('faucet/autonomous-faucet.ts',{'../runtime/manual-power-state.js':power,'../runtime/core-runtime.js':{ensureCryptoCrawlerCoreRuntime:()=>{starts++;return gate.promise;}},'../integration/canonical-runtime-wiring.js':{ensureCanonicalCryptoCrawlerRuntimeWiring(){}},'../execution/canonical-execution-scheduler.js':{canonicalExecutionScheduler:{getStats:()=>({running:true})}}}).AutonomousCryptoFaucet;
    const faucet=new Faucet();const one=faucet.runAutonomousLoop();const two=faucet.runAutonomousLoop();assert.equal(starts,1);
    faucet.stop();power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');gate.resolve();
    const results=await Promise.allSettled([one,two]);assert(results.every(r=>r.status==='rejected'));assert.equal(faucet.isActive(),false);
  });
  await check('private sockets terminate on OFF and cannot reopen after a late connection',async()=>{
    const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');
    const {EventEmitter}=require('node:events');const gate=deferred();
    class Socket extends EventEmitter {constructor(){super();this.readyState=1;this.terminated=0;}terminate(){this.terminated++;this.readyState=3;this.emit('close');}}
    const Base=load('execution/cex-private-websocket-order-transport.ts',{'../runtime/manual-power-state.js':power,'../../../logger.js':log,ws:{OPEN:1}},'\nexport { PersistentPrivateOrderSocket };').PersistentPrivateOrderSocket;
    const socket=new Socket();
    class Transport extends Base {venue='okx';async connectAndAuthenticate(){this.trackConnectingSocket(socket);await gate.promise;return socket;}heartbeat(){}responseKey(){return null;}}
    const transport=new Transport();const starting=transport.ensureReady();await tick();power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');gate.resolve();
    await assert.rejects(starting,/OFF/);assert(socket.terminated>0);assert.equal(transport.socket,null);transport.stop();
  });
  await check('public quote lookup after OFF makes no calls and a late identity cannot open sockets',async()=>{
    const power=load('runtime/manual-power-state.ts');const gate=deferred();let lookups=0,sockets=0;
    class Socket {constructor(){sockets++;}}
    const streams=load('intelligence/cex-order-book-stream.ts',{'../runtime/manual-power-state.js':power,'../../../logger.js':log,ws:Socket,'../execution/cex-spot-product-policy.js':{getSpotProductConstraints:()=>{lookups++;return gate.promise;}}}).cexOrderBookStreams;
    assert.equal(await streams.getQuote('okx','BTCUSDT'),null);assert.equal(lookups,0);
    power.setCryptoCrawlerManualPowerPhase('STARTING');const pending=streams.getQuote('okx','BTCUSDT');await tick();power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');
    gate.resolve({symbol:'BTCUSDT',exchangeSymbol:'BTC-USDT'});assert.equal(await pending,null);assert.equal(sockets,0);streams.stop();
  });
  const originalFetch=global.fetch;
  try {
    process.env.OKX_API_KEY='fixture-key';process.env.OKX_API_SECRET='fixture-secret';process.env.OKX_API_PASSPHRASE='fixture-passphrase';delete process.env.OKX_API_BASE_URL;
    process.env.CRYPTO_OKX_FEE_STARTUP_GRACE_MS='0';process.env.CRYPTO_OKX_FEE_MIN_INTERVAL_MS='425';
    await check('OKX selects a successful regional endpoint instead of blaming a valid key',async()=>{
      const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');const hosts=[];
      global.fetch=async url=>{const host=new URL(url).hostname;hosts.push(host);return new Response(JSON.stringify({code:host==='eea.okx.com'?'0':'50119',data:[]}));};
      const auth=load('intelligence/cex-private-authority.ts',{'../runtime/manual-power-state.js':power,'../../../logger.js':log,'../../../db.js':{isDatabaseConfigured:false}});
      const response=await auth.okxPrivateRequest('/api/v5/account/balance','GET');assert.equal(response.baseUrl,'https://eea.okx.com');assert.deepEqual(hosts.slice(0,3),['us.okx.com','openapi.okx.com','eea.okx.com']);
      const before=hosts.length;power.setCryptoCrawlerManualPowerPhase('OFF');await assert.rejects(auth.okxPrivateRequest('/api/v5/account/balance','GET'),/OFF/);assert.equal(hosts.length,before);
    });
    await check('OFF aborts a pending venue response body, with no further region probes',async()=>{
      const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');const entered=deferred();let calls=0;
      global.fetch=async (_url,{signal})=>{calls++;return {status:200,headers:new Headers(),text:()=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered.resolve();})};};
      const auth=load('intelligence/cex-private-authority.ts',{'../runtime/manual-power-state.js':power,'../../../logger.js':log,'../../../db.js':{isDatabaseConfigured:false}});
      const pending=auth.getOkxExecutionRestBaseUrl();await entered.promise;power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');await assert.rejects(pending,/OFF/);assert.equal(calls,1);
    });
  } finally { global.fetch=originalFetch; }
  console.log(`PASS ${count} power consistency checks; all external I/O mocked`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
