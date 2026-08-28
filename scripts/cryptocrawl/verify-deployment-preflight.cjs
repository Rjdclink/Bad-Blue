const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const req = (s,t) => { if (!s.includes(t)) process.exit(41); };
const no = (s,t) => { if (s.includes(t)) process.exit(42); };

const canonicalIndex=read('server/services/cryptocrawl/index.ts');
const canonicalRuntime=read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const masterShim=read('server/services/cryptocrawl/integration/master-orchestrator-measured-wiring.ts');
const masterPipeline=read('server/services/cryptocrawl/integration/master-pipeline.ts');
const killSwitch=read('server/services/cryptocrawl/governance/kill-switch.ts');
const enhanced=read('server/services/cryptocrawl/agents/enhanced-micro-crawler.ts');
const swarm=read('server/services/cryptocrawl/agents/swarm-orchestrator.ts');
const starburst=read('server/services/cryptocrawl/agents/starburst-replication.ts');
const snake=read('server/services/cryptocrawl/agents/starburst-snake.ts');
const readiness=read('server/services/cryptocrawl/execution/execution-readiness.ts');
const relay=read('server/services/cryptocrawl/execution/multi-relay-submitter.ts');

for (const t of ['CryptoCrawler canonical public surface','ensureCanonicalCryptoCrawlerRuntimeWiring','ensureAuthoritativeMonteCarloWiring','canonicalExecutionScheduler','assessCanonicalExecutionEnvironment']) req(canonicalIndex,t);
for (const t of ['assessSharedExecutionEnvironment','getSharedExecutionCapabilities','SixCaneSystem','sixCaneSystem','DivineOptimizationEngine','StarburstEngine','EdenStorage','ELITE_STRATEGIES','MARKET_CONDITIONS','swarmIntelligence','CryptocrawlerAIHarmony',"from './core/lux-swarm","from './core/master-orchestrator"]) no(canonicalIndex,t);
for (const t of ['master-orchestrator','lux-swarm','eden/service','starburst']) no(canonicalRuntime,t);
req(canonicalRuntime,'executionAuthorityGranted: false');
req(masterShim,'ensureCanonicalCryptoCrawlerRuntimeWiring()'); no(masterShim,'../core/master-orchestrator');
for (const t of ["from '../core/lux-swarm",'StealthSuperiority','TripleDipExtractor','ReinforcementLearningBidder','assessSharedExecutionEnvironment']) no(masterPipeline,t);
for (const t of ['canonicalExecutionScheduler','assessCanonicalExecutionEnvironment']) req(masterPipeline,t);
for (const t of ['normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY)','privateRelayOptional: true','[krakenConfigured, okxConfigured, coinbaseConfigured].filter(Boolean).length >= 2','!noExecutionGuardEnabled && liveExecutionEnabled && liveExecutionConfirmed']) req(readiness,t);
no(readiness,'flashbotsAuthConfigured = rpcConfigured');
for (const t of ['direct broadcast remains authoritative','process.env.FLASHBOTS_AUTH_KEY?.trim()','providers.size === 0']) req(relay,t); no(relay,'randomBytes');
no(killSwitch,'../eden/'); no(killSwitch,'../agents/swarm-orchestrator'); req(killSwitch,'stageManager.pause'); req(killSwitch,'riskGovernor.exportState');
for (const s of [enhanced,swarm,starburst,snake]) { req(s,'COMPATIBILITY SHELL'); no(s,'Math.random'); no(s,'simulateExecution'); }
req(enhanced,'profitGenerated: 0'); req(starburst,'success: false'); req(starburst,'replicasCreated: 0');

console.log('[deployment-preflight] DIAGNOSTIC first-half clean-house passed; holding 30s');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
process.exit(77);
