'use strict';
// Actual modules, deterministic provider/transport fixtures; no application startup.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const esbuild=require('esbuild');
const ethers=require('ethers');
const {BigNumber:BN}=ethers;
const root='server/services/cryptocrawl/';
function load(file,mocks={}){
 const mod={exports:{}};
 const code=esbuild.transformSync(fs.readFileSync(root+file,'utf8').replace(/\bimport\(/g,'__import('),{loader:'ts',format:'cjs',target:'es2022'}).code;
 Function('require','module','exports','__import',code)(name=>mocks[name]??(name==='ethers'||name.startsWith('node:')?require(name):{}),mod,mod.exports,name=>Promise.resolve(mocks[name]??{}));
 return mod.exports;
}
const log={info(){},warn(){},error(){},debug(){}};
const tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
async function main(){
 const fees=load('execution/chain-native-fees.ts');
 const iface=new ethers.utils.Interface(['function getL1Fee(bytes) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)']);
 const receipt={transactionHash:'0x'+'ab'.repeat(32),blockHash:'0x'+'cd'.repeat(32),blockNumber:123,gasUsed:BN.from(100),effectiveGasPrice:BN.from(2)};
 const provider={getBlockNumber:async()=>123,call:async(tx,block)=>{assert.equal(block,123);const parsed=iface.parseTransaction(tx);return iface.encodeFunctionResult(parsed.name,[parsed.name==='getL1Fee'?30:7]);},send:async()=>({...receipt,l1Fee:'0x1e'})};
 await check('OP reservation includes data and operator fees at one block',async()=>{
  assert.equal((await fees.estimateAdditionalNativeFees({provider,chainId:10,unsignedTransaction:'0x1234',gasLimit:BN.from(100)})).toString(),'37');
 });
 await check('OP actual cost includes execution, data and operator cost',async()=>{
  assert.equal((await fees.measureReceiptNativeFees({provider,chainId:10,receipt})).toString(),'237');
 });
 await check('Arbitrum fee is not charged its L1 component twice',async()=>{
  assert.equal((await fees.measureReceiptNativeFees({provider:{},chainId:42161,receipt})).toString(),'200');
  assert.equal((await fees.estimateAdditionalNativeFees({provider:{},chainId:42161,unsignedTransaction:'0x',gasLimit:BN.from(100)})).toString(),'0');
 });
 await check('missing or mismatched fee evidence cannot become zero cost',async()=>{
  await assert.rejects(fees.measureReceiptNativeFees({provider,chainId:1,receipt:{...receipt,effectiveGasPrice:undefined}}),/measured effective/);
  for(const raw of [{...receipt},{...receipt,l1Fee:30,blockHash:'wrong'}]) {
   await assert.rejects(fees.measureReceiptNativeFees({provider:{...provider,send:async()=>raw},chainId:10,receipt}),/matching L1/);
  }
 });
 await check('unsigned oracle payload preserves EIP-1559 transaction economics',async()=>{
  const unsigned=ethers.utils.serializeTransaction({chainId:10,type:2,nonce:9,gasLimit:123456,maxFeePerGas:20,maxPriorityFeePerGas:2,to:'0x'+'11'.repeat(20),value:0,data:'0xabcd',accessList:[]});
  assert.equal(fees.unsignedFeePayload(ethers.utils.parseTransaction(unsigned)),unsigned);
 });
 const sponsor=load('strategies/gas-sponsorship.ts');
 await check('failed UserOperation is rejected even inside a successful bundle',async()=>{
  const manager=sponsor.getGasSponsorManager();const hash='0x'+'22'.repeat(32);
  manager.rpc=async(_chain,method)=>method==='eth_sendUserOperation'?hash:{success:false,receipt:{status:'0x1',transactionHash:hash}};
  await assert.rejects(manager.submitAndWait({chainId:10,userOperationHash:hash,userOperation:{}},5000,100),/REVERTED/);
 });
 await check('sponsor billing uses this operation cost and rounds surcharge up',async()=>{
  const manager=sponsor.getGasSponsorManager();const hash='0x'+'22'.repeat(32);
  manager.rpc=async(_chain,method)=>method==='eth_sendUserOperation'?hash:{success:true,actualGasUsed:'0x64',actualGasCost:'0x65',receipt:{status:'0x1',transactionHash:hash,gasUsed:'0xffff'}};
  const result=await manager.submitAndWait({chainId:10,userOperationHash:hash,userOperation:{}},5000,100);
  assert.equal(sponsor.sponsoredBilledGasCostWei(result,100),103n);
  assert.throws(()=>sponsor.sponsoredBilledGasCostWei({...result,actualGasCostWei:undefined},0),/lacks individual/);
 });
 await check('Ghost operation failure is not hidden by bundle success; OFF sends no receipt calls',async()=>{
  const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');
  const oldFetch=global.fetch, oldKey=process.env.GHOST_WALLET_PIMLICO_API_KEY;let calls=0;
  process.env.GHOST_WALLET_PIMLICO_API_KEY='test-only-not-a-credential';
  try {
   global.fetch=async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({result:{success:false,actualGasCost:'0x64',receipt:{status:'0x1',transactionHash:'0x'+'33'.repeat(32)}}})};};
   const ghost=load('ghost-wallet/ghost-wallet-pimlico-sponsor.ts',{'../runtime/manual-power-state.js':power});
   const receipt=await ghost.getGhostWalletPimlicoReceipt('ethereum','0x'+'44'.repeat(32));assert.equal(receipt.success,false);
   power.setCryptoCrawlerManualPowerPhase('OFF');
   await assert.rejects(ghost.getGhostWalletPimlicoReceipt('ethereum','0x'+'44'.repeat(32)),/OFF/);assert.equal(calls,1);
  } finally {global.fetch=oldFetch;if(oldKey===undefined)delete process.env.GHOST_WALLET_PIMLICO_API_KEY;else process.env.GHOST_WALLET_PIMLICO_API_KEY=oldKey;}
 });
 await check('OFF invalidates old work even after an immediate restart',async()=>{
  const power=load('runtime/manual-power-state.ts');assert.throws(power.captureCryptoCrawlerWorkGuard(),/OFF/);
  power.setCryptoCrawlerManualPowerPhase('STARTING');const old=power.captureCryptoCrawlerWorkGuard();old();
  power.setCryptoCrawlerManualPowerPhase('STOPPING');power.setCryptoCrawlerManualPowerPhase('STARTING');assert.throws(old,/OFF/);power.captureCryptoCrawlerWorkGuard()();
  power.setCryptoCrawlerManualPowerPhase('OFF');
 });
 await check('late Ghost schema completion cannot revive a stopped service',async()=>{
  const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');const gate=defer();
  const reserve=load('ghost-wallet/ghost-wallet-gas-reserve.ts',{'../runtime/manual-power-state.js':power,'../../../logger.js':log,'./ghost-wallet-gas-reserve-schema.js':{ensureGhostWalletGasReserveSchema:()=>gate.promise}}).ghostWalletGasReserve;
  const starting=reserve.start();reserve.stop();power.setCryptoCrawlerManualPowerPhase('OFF');power.setCryptoCrawlerManualPowerPhase('STARTING');gate.resolve();
  await assert.rejects(starting,/OFF|cancelled/);assert.equal(reserve.running,false);power.setCryptoCrawlerManualPowerPhase('OFF');
 });
 await check('core shutdown stops treasury confirmation even before core discovery initialized',async()=>{
  const power=load('runtime/manual-power-state.ts');let stopped=0;
  const core=load('runtime/core-runtime.ts',{
   './manual-power-state.js':power,'../../../logger.js':log,
   '../execution/controlled-loss-learning-runtime.js':{stopControlledLossLearningWorker(){}},
   '../execution/system-capital-sweep-worker.js':{stopSystemCapitalSweepWorker(){}},
   '../execution/cex-treasury-transfer-worker.js':{stopCexTreasuryTransferWorker(){}},
   '../execution/treasury-transfer-recovery-worker.js':{stopTreasuryTransferRecoveryWorker(){}},
   './system-capital-placement-wiring.js':{stopSystemCapitalPlacementReconciliation(){}},
   './rainbow-profit-bridge-wiring.js':{stopRainbowProfitBridgeWiring(){stopped++;}},
  });
  await core.stopCryptoCrawlerCoreRuntime();assert.equal(stopped,1);
  await assert.rejects(core.ensureCryptoCrawlerCoreRuntime(),/OFF/);
 });
 await check('one broken teardown hook cannot skip later worker shutdown',async()=>{
  let ghostStopped=0;
  const wiring=load('integration/canonical-runtime-wiring.ts',{
   '../../../logger.js':log,
   '../ghost-wallet/ghost-wallet-ultra-worker.js':{ghostWalletUltraWorker:{stop:async()=>{ghostStopped++;}}},
  });
  // Other missing fixture hooks deliberately throw; the late worker must still stop.
  await assert.rejects(wiring.deactivateCanonicalCryptoCrawlerRuntimeWiring(),/teardown incomplete/);
  assert.equal(ghostStopped,1);assert.equal(wiring.getCanonicalCryptoCrawlerActivationState().activationAllowed,false);
 });
 await check('economic reduction teardown calls the real imported rescue stop hook',async()=>{
  let stopped=0;
  const wiring=load('integration/economic-transformation-wiring.ts',{'./universal-bps-rescue-coordinator.js':{stopUniversalBpsRescueCoordinator(){stopped++;}}});
  wiring.stopEconomicTransformationWiring();assert.equal(stopped,1);
 });
 await check('prepared all-in gas cannot exceed the opportunity cost budget',async()=>{
  const prices=new Map([['ETH',2000],['USDC',1]]);
  const economics=load('discovery/configured-zero-capital-gas-economics.ts');
  const budget=load('execution/prepared-native-fee-budget.ts',{'../bridge/live-price-mesh.js':{livePriceMesh:{getLiveSymbolPrices:async()=>prices}},'../discovery/configured-zero-capital-gas-economics.js':economics});
  const input={chain:'optimism',inputAssetSymbol:'USDC',inputTokenDecimals:6,budgetInInputToken:1000000n,maximumWei:BN.from('1000000000000000')};
  await assert.rejects(budget.validatePreparedNativeFeeBudget(input),/exceeds selected/);
  await budget.validatePreparedNativeFeeBudget({...input,budgetInInputToken:2000000n});
  prices.delete('ETH');await assert.rejects(budget.validatePreparedNativeFeeBudget(input),/lacks fresh/);
 });
 await check('settlement backfill makes no follow-up calls after OFF',async()=>{
  const power=load('runtime/manual-power-state.ts');power.setCryptoCrawlerManualPowerPhase('STARTING');const gate=defer();let followups=0;
  const scope=load('runtime/discovery-work-context.ts');
  const p={connection:{url:'mock'},getBlockNumber:()=>gate.promise};
  const events=load('ghost-wallet/ghost-wallet-chain-events.ts',{
   '../runtime/manual-power-state.js':power,'../runtime/discovery-work-context.js':scope,'../../../logger.js':log,
   './ghost-wallet-provider-mesh.js':{ghostWalletProviderMesh:{getProviders:async()=>[p],getLogProviders:async()=>[p]}},
   './ghost-wallet-runtime-state.js':{getGhostWalletReconciledBlock:async()=>{followups++;return 1;}},
  }).ghostWalletChainEvents;
  events.stopping=false;
  events.queueBackfill({chain:'ethereum',addresses:['0x'+'11'.repeat(20)],provider:p,listenerConnected:false});await tick();
  power.setCryptoCrawlerManualPowerPhase('OFF');gate.resolve(100);await tick();await tick();assert.equal(followups,0);assert.equal(events.backfillRetryTimers.size,0);
 });
 console.log(`PASS ${checks} fee/lifecycle checks; external I/O mocked`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
