const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const req = (s,t) => { if (!s.includes(t)) process.exit(41); };
const no = (s,t) => { if (s.includes(t)) process.exit(42); };

const barrels = [
 ['agents',read('server/services/cryptocrawl/agents/index.ts'),['CainCrawler','CainTwinHybrid','ConjoinedTwinCrawler','SwarmOrchestrator']],
 ['eden',read('server/services/cryptocrawl/eden/index.ts'),['EdenService','EdenDeploymentManager','edenCainStates']],
 ['ai',read('server/services/cryptocrawl/ai/index.ts'),['CryptocrawlerAIHarmony','cryptocrawlerAIHarmony']],
 ['optimization',read('server/services/cryptocrawl/optimization/index.ts'),['DivineOptimizationEngine','getDivineEngine']],
 ['training',read('server/services/cryptocrawl/training/index.ts'),['scheduledMonteCarloTraining','ScheduledMonteCarloTraining']],
 ['evolution',read('server/services/cryptocrawl/evolution/index.ts'),['HyperEvolutionEngine','SwarmIntelligenceEngine','FrontierResearchEngine']],
 ['faucet',read('server/services/cryptocrawl/faucet/index.ts'),['FacetSimulationEngine','HighRiskSimulationEngine','runComplianceSimulation']],
 ['capital-free',read('server/services/cryptocrawl/capital-free/index.ts'),['BarterSystem','PartnershipFormationSystem','StarburstScalingSystem','NexGenProtocolLayer']],
];
for (const [,s,forbidden] of barrels) for (const t of forbidden) no(s,t);
req(barrels[5][1],'recordMeasuredEvolutionFeedback'); req(barrels[7][1],'AlchemyIntegration');
const bridge=read('server/services/cryptocrawl/bridge/index.ts'); no(bridge,'withdraw-deposit'); no(bridge,'withdrawDepositManager');
const faucet=read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
for (const t of ['Canonical CryptoCrawler lifecycle compatibility facade','canonicalExecutionScheduler.start()','maxHourlyProfit: Number.POSITIVE_INFINITY','dailyTarget: 0']) req(faucet,t);
for (const t of ['makeCloseDecision(','executeWithStealth(','Math.random']) no(faucet,t);
const fc=read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts'); req(fc,'Legacy faucet concurrency patch retired'); no(fc,'target.makeOpenDecision');
const mesh=read('server/services/cryptocrawl/faucet/higher-order-mesh.ts'); req(mesh,'Legacy compatibility surface only'); no(mesh,'Math.random');
const apiIndex=read('server/services/cryptocrawl/api/index.ts'); req(apiIndex,'./canonical-dashboard-api.js');
const legacyDash=read('server/services/cryptocrawl/api/dashboard-api.ts'); req(legacyDash,"from './canonical-dashboard-api.js'"); no(legacyDash,'setTimeout('); no(legacyDash,'DivineOptimizer');
const dash=read('server/services/cryptocrawl/api/canonical-dashboard-api.ts'); for (const t of ['canonicalOpportunityState','canonicalExecutionScheduler','canonical_terminal_settlement']) req(dash,t); no(dash,'Math.random');
const admin=read('server/services/cryptocrawl/api/truthful-admin-diagnostics.ts'); req(admin,'mutableHere: false'); req(admin,'diagnostics-only');
const wallet=read('server/services/cryptocrawl/core/wallet.ts'); for (const t of ['encryptedKey','mnemonic','loadFromDB','saveToDB']) no(wallet,t); req(wallet,'direct wallet withdrawal is disabled');
const shield=read('server/services/cryptocrawl/risk/mandatory-risk-shield.ts'); req(shield,'retired');
const circuit=read('server/services/cryptocrawl/risk/circuit-breaker.ts'); req(circuit,'retired');
const exec=read('server/services/cryptocrawl/orchestrator/execution-orchestrator.ts'); req(exec,'retired'); no(exec,'Math.random');
const flash=read('server/services/cryptocrawl/core/flashloan-atomic-engine.ts'); req(flash,'Legacy compatibility surface only'); no(flash,'Math.random'); req(flash,'success: false');
console.log('[deployment-preflight] DIAGNOSTIC middle clean-house passed; holding 30s');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
process.exit(77);
