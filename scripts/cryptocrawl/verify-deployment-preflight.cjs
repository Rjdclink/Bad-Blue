const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const req = (s,t) => { if (!s.includes(t)) process.exit(41); };
const no = (s,t) => { if (s.includes(t)) process.exit(42); };
const barrels = [
 [read('server/services/cryptocrawl/agents/index.ts'),['CainCrawler','CainTwinHybrid','ConjoinedTwinCrawler','SwarmOrchestrator']],
 [read('server/services/cryptocrawl/eden/index.ts'),['EdenService','EdenDeploymentManager','edenCainStates']],
 [read('server/services/cryptocrawl/ai/index.ts'),['CryptocrawlerAIHarmony','cryptocrawlerAIHarmony']],
 [read('server/services/cryptocrawl/optimization/index.ts'),['DivineOptimizationEngine','getDivineEngine']],
 [read('server/services/cryptocrawl/training/index.ts'),['scheduledMonteCarloTraining','ScheduledMonteCarloTraining']],
 [read('server/services/cryptocrawl/evolution/index.ts'),['HyperEvolutionEngine','SwarmIntelligenceEngine','FrontierResearchEngine']],
 [read('server/services/cryptocrawl/faucet/index.ts'),['FacetSimulationEngine','HighRiskSimulationEngine','runComplianceSimulation']],
 [read('server/services/cryptocrawl/capital-free/index.ts'),['BarterSystem','PartnershipFormationSystem','StarburstScalingSystem','NexGenProtocolLayer']],
];
for (const [s,forbidden] of barrels) for (const t of forbidden) no(s,t);
req(barrels[5][0],'recordMeasuredEvolutionFeedback'); req(barrels[7][0],'AlchemyIntegration');
const bridge=read('server/services/cryptocrawl/bridge/index.ts'); no(bridge,'withdraw-deposit'); no(bridge,'withdrawDepositManager');
const faucet=read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
for (const t of ['Canonical CryptoCrawler lifecycle compatibility facade','canonicalExecutionScheduler.start()','maxHourlyProfit: Number.POSITIVE_INFINITY','dailyTarget: 0']) req(faucet,t);
for (const t of ['makeCloseDecision(','executeWithStealth(','Math.random']) no(faucet,t);
const fc=read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts'); req(fc,'Legacy faucet concurrency patch retired'); no(fc,'target.makeOpenDecision');
const mesh=read('server/services/cryptocrawl/faucet/higher-order-mesh.ts'); req(mesh,'Legacy compatibility surface only'); no(mesh,'Math.random');
console.log('[deployment-preflight] DIAGNOSTIC barrels/faucet passed; holding 30s');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
process.exit(77);
