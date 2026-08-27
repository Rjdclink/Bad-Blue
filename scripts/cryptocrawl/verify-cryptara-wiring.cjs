const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContains(source, pattern, description) {
  if (!source.includes(pattern)) {
    throw new Error(`Missing invariant: ${description}`);
  }
}

function assertNotContains(source, pattern, description) {
  if (source.includes(pattern)) {
    throw new Error(`Unsafe invariant: ${description}`);
  }
}

function assertBefore(source, firstPattern, secondPattern, description) {
  if (source.indexOf(firstPattern) < 0 || source.indexOf(secondPattern) < 0 || source.indexOf(firstPattern) >= source.indexOf(secondPattern)) {
    throw new Error(`Ordering invariant failed: ${description}`);
  }
}

const cryptara = read('server/services/cryptara/index.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const execution = read('server/services/cryptocrawl/execution/index.ts');
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const riskGovernor = read('server/services/cryptocrawl/governance/risk-governor.ts');
const cryptaraGovernance = read('server/services/cryptocrawl/governance/cryptara-integration.ts');
const stageManagement = read('server/services/cryptocrawl/governance/stage-management.ts');
const masterPipeline = read('server/services/cryptocrawl/integration/master-pipeline.ts');
const tradingView = read('server/services/cryptocrawl/babel/tradingview-integration.ts');
const legacy = read('server/cryptaraModule.ts');
const hyperMonteCarlo = read('server/services/cryptocrawl/validation/monte-carlo-hyper-engine.ts');
const runtimeConfidenceBootstrap = read('server/services/cryptocrawl/validation/runtime-confidence-bootstrap.ts');
const bootstrapWiring = read('server/services/cryptocrawl/integration/cryptara-bootstrap-wiring.ts');
const beamWiring = read('server/services/cryptocrawl/integration/cryptara-beam-wiring.ts');
const assessmentWiring = read('server/services/cryptocrawl/integration/cryptara-assessment-wiring.ts');
const scheduledTraining = read('server/services/cryptocrawl/training/scheduled-monte-carlo-training.ts');

assertContains(cryptara, 'CryptaraOpportunityContext', 'authoritative Cryptara accepts normalized opportunity context');
assertContains(cryptara, 'recordOpportunityObservation', 'Cryptara records candidate intelligence');
assertContains(cryptara, 'missingInformation', 'missing information is represented explicitly');
assertContains(cryptara, 'provenance', 'Cryptara assessments retain provider provenance');
assertContains(cryptara, 'updatePredictionCalibration', 'execution outcomes calibrate opportunity predictions');
assertContains(cryptara, 'getPredictionCalibration', 'prediction calibration is observable');
assertNotContains(cryptara, 'requiresHumanApproval', 'Cryptara does not add a human approval prerequisite');

assertContains(faucet, 'marketDataProviders.discoverUniverse()', 'canonical faucet discovers the broadened market universe');
assertContains(faucet, 'cryptara.assessOpportunity({', 'all verified faucet candidates reach Cryptara');
assertContains(faucet, 'const candidateAssessments: Awaited<ReturnType<typeof cryptara.assessOpportunity>>[] = [];', 'candidate assessments use the authoritative Cryptara assessment contract');
assertContains(faucet, 'candidateAssessments.push(await cryptara.assessOpportunity({', 'Cryptara assesses candidates before ranking');
assertContains(faucet, 'const plan = [...verifiedPlans].sort(', 'candidate selection occurs after Cryptara assessments');
assertBefore(faucet, 'candidateAssessments.push(await cryptara.assessOpportunity({', 'const plan = [...verifiedPlans].sort(', 'candidate assessment precedes plan selection');
assertContains(faucet, 'arbitrageVerifier.evaluateOnce(', 'canonical live quote verification remains in place');
assertContains(faucet, 'evaluateMarketGates(', 'Cryptara advisory gates remain in the faucet path');
assertContains(execution, 'recordCryptaraExecutionFeedback({', 'execution outcomes are recorded');
assertContains(execution, "normalized?.terminal === true", 'only terminal settlement results enter Cryptara feedback');
assertContains(execution, 'explicitPayloadRequired: true', 'execution readiness reports the explicit payload requirement');
assertContains(execution, 'measuredSettlementFeeUsd', 'measured exchange and network costs reach feedback');
assertContains(progression, 'cryptara.recordExecutionResult(feedback)', 'governance forwards outcomes to authoritative Cryptara');
assertContains(riskGovernor, 'measuredFeeUSD?: number;', 'governance proposals can carry measured venue fees');
assertContains(cryptaraGovernance, 'measured venue fee and slippage are required', 'governance execution envelope fails closed without measured costs');
assertNotContains(cryptaraGovernance, 'const feeBps = 30', 'governance does not fabricate a venue fee');
assertContains(riskGovernor, 'getLatestMonteCarloEvidence()', 'risk governance consumes canonical Cryptara Monte Carlo evidence');
assertNotContains(riskGovernor, 'baseSuccessRate: 0.7', 'risk governance does not fabricate a Monte Carlo success rate');
assertNotContains(riskGovernor, 'MARKET_CONDITIONS.normal', 'risk governance does not force a normal market regime');
assertContains(stageManagement, 'averageSlippageBps: value.cryptara.averageSlippageBps === null', 'missing slippage remains explicit in persisted evidence');
assertContains(masterPipeline, 'generic LuxSwarm execution is not authoritative', 'generic observations cannot reach the execution boundary');
assertContains(tradingView, "cached.dataProvenance === 'live' ? 'cached' : 'deterministic-fallback'", 'cached TradingView fallback provenance is preserved');
assertContains(tradingView, 'TradingView payload contains incomplete indicator data', 'incomplete TradingView data cannot be labeled live');

assertContains(hyperMonteCarlo, "from 'node:worker_threads'", 'Hyper Monte Carlo uses CPU worker threads');
assertContains(hyperMonteCarlo, 'HyperMonteCarloMode', 'Hyper Monte Carlo exposes live/training modes');
assertContains(hyperMonteCarlo, 'function wilson', 'adaptive stopping is driven by a statistical confidence interval');
assertContains(hyperMonteCarlo, 'controlVariateBeta', 'control-variate mean reduction is implemented and observable');
assertContains(hyperMonteCarlo, 'measuredLatenciesMs', 'measured execution latency feeds the stochastic model');
assertContains(hyperMonteCarlo, 'measuredSlippageBps', 'measured slippage feeds the stochastic model');
assertContains(hyperMonteCarlo, 'executionDeadlineMs', 'quote lifetime produces an execution deadline');
assertContains(hyperMonteCarlo, 'probabilityBothLegsFill', 'joint execution/fill probability is measured');
assertContains(hyperMonteCarlo, 'stoppedEarly', 'adaptive Monte Carlo can stop before the maximum path budget');

assertContains(runtimeConfidenceBootstrap, 'DEFAULT_RUNTIME_CONFIDENCE_SUCCESS_THRESHOLD = 10', 'runtime confidence requires ten successful trades by default');
assertContains(runtimeConfidenceBootstrap, 'feedback.settlementConfirmed !== true', 'unconfirmed settlements cannot advance runtime confidence');
assertContains(runtimeConfidenceBootstrap, 'feedback.realizedProfitUsd <= 0', 'non-profitable outcomes cannot count as successful confidence-bootstrap trades');
assertContains(runtimeConfidenceBootstrap, 'successfulTradeKeys', 'duplicate settlement feedback cannot advance the bootstrap twice');
assertContains(runtimeConfidenceBootstrap, "state: confidenceEnabled ? 'calibrated' : 'bootstrap'", 'confidence state is explicit rather than fabricated');

assertContains(bootstrapWiring, 'runHyperMonteCarlo', 'Cryptara production opportunity analysis uses the Hyper Engine');
assertContains(bootstrapWiring, 'sourceObservedAt', 'Monte Carlo evidence is bound to a unique observation, not only a reusable opportunity ID');
assertContains(bootstrapWiring, 'technicalProvenance: context.tradingView?.dataProvenance', 'technical provenance feeds evidence quality without becoming a binary availability gate');
assertNotContains(bootstrapWiring, "missingInformation.push('live_technical_analysis')", 'cached TradingView data is not a binary Monte Carlo availability gate');
assertNotContains(bootstrapWiring, 'createMonteCarloEngine(', 'production Cryptara wiring no longer runs the legacy v3 strategy simulator');
assertContains(bootstrapWiring, 'confidenceBootstrap.record(feedback)', 'every new measured execution can advance runtime confidence state');
assertContains(bootstrapWiring, "continuousLearning: 'every_terminal_execution'", 'trade feedback is the primary continuous learning path');
assertContains(bootstrapWiring, "missingInformation.push('runtime_confidence_bootstrap')", 'bootstrap confidence unavailability remains explicit');

assertContains(beamWiring, 'structuredClone(sourceContext)', 'Beam receives a detached immutable opportunity snapshot');
assertContains(beamWiring, 'context: immutableContext', 'Beam task input carries the exact opportunity context');
assertContains(beamWiring, 'originalRun(workloadInput.context, beamContext.signal)', 'Beam executes the exact snapshot and propagates cancellation');
assertNotContains(beamWiring, 'return originalRun();', 'Beam no longer dereferences shared mutable Cryptara context');
assertNotContains(beamWiring, 'Computational Beam Monte Carlo workload unavailable', 'evidence/model failures are no longer mislabeled as Beam unavailability');

assertContains(assessmentWiring, 'target.latestMonteCarloEvidence = null', 'every market observation clears stale Monte Carlo evidence first');
assertContains(assessmentWiring, 'target.runMonteCarloSimulation(context)', 'assessment passes its exact opportunity context into Monte Carlo');
assertContains(assessmentWiring, 'opportunityId}:${context.observedAt}', 'warning state is isolated per observation');

assertContains(riskGovernor, 'const confidencePass = !confidenceEnabled || confidenceScore >= 0.7;', 'Risk Governor bypasses learned confidence only during bootstrap');
assertContains(riskGovernor, 'if (confidenceEnabled)', 'disabled confidence contributes no artificial risk penalty');
assertContains(riskGovernor, 'consensus >= 0.7', 'Monte Carlo probability threshold remains active during confidence bootstrap');
assertContains(riskGovernor, 'evidence!.expectedProfit > 0', 'verified positive economics remain required during confidence bootstrap');

assertContains(scheduledTraining, 'createMonteCarloEngine(', 'existing scheduled trainer remains untouched');
assertContains(scheduledTraining, 'ELITE_STRATEGIES', 'existing scheduled training strategy rotation remains untouched');
assertNotContains(scheduledTraining, 'runHyperMonteCarlo(request)', 'Hyper live learning does not replace the existing scheduler');

assertContains(legacy, 'compatibility module', 'legacy neural module is explicitly classified');
assertContains(legacy, 'used as a second execution or progression authority', 'legacy module cannot claim governance authority');

console.log('Cryptara wiring verification passed.');
