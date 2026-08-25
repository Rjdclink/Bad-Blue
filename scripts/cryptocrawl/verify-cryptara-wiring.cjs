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
const tradingView = read('server/services/cryptocrawl/babel/tradingview-integration.ts');
const legacy = read('server/cryptaraModule.ts');

assertContains(cryptara, 'CryptaraOpportunityContext', 'authoritative Cryptara accepts normalized opportunity context');
assertContains(cryptara, 'recordOpportunityObservation', 'Cryptara records candidate intelligence');
assertContains(cryptara, 'missingInformation', 'missing information is represented explicitly');
assertContains(cryptara, 'provenance', 'Cryptara assessments retain provider provenance');
assertContains(cryptara, 'updatePredictionCalibration', 'execution outcomes calibrate opportunity predictions');
assertContains(cryptara, 'getPredictionCalibration', 'prediction calibration is observable');
assertNotContains(cryptara, 'requiresHumanApproval', 'Cryptara does not add a human approval prerequisite');

assertContains(faucet, 'marketDataProviders.discoverUniverse()', 'canonical faucet discovers the broadened market universe');
assertContains(faucet, 'recordOpportunityObservation', 'all verified faucet candidates reach Cryptara');
assertContains(faucet, 'const candidateAssessments: Awaited<ReturnType<typeof cryptara.assessOpportunity>>[] = [];', 'candidate assessments use the authoritative Cryptara assessment contract');
assertContains(faucet, 'candidateAssessments.push(await cryptara.assessOpportunity({', 'Cryptara assesses candidates before ranking');
assertContains(faucet, 'const plan = [...verifiedPlans].sort(', 'candidate selection occurs after Cryptara assessments');
assertBefore(faucet, 'candidateAssessments.push(await cryptara.assessOpportunity({', 'const plan = [...verifiedPlans].sort(', 'candidate assessment precedes plan selection');
assertContains(faucet, 'arbitrageVerifier.evaluateOnce(', 'canonical live quote verification remains in place');
assertContains(faucet, 'evaluateMarketGates(', 'Cryptara advisory gates remain in the faucet path');
assertContains(execution, 'recordCryptaraExecutionFeedback({', 'execution outcomes are recorded');
assertContains(execution, "normalized?.terminal === true", 'only terminal settlement results enter Cryptara feedback');
assertContains(execution, 'measuredSettlementFeeUsd', 'measured exchange and network costs reach feedback');
assertContains(progression, 'cryptara.recordExecutionResult(feedback)', 'governance forwards outcomes to authoritative Cryptara');
assertContains(tradingView, "cached.dataProvenance === 'live' ? 'cached' : 'deterministic-fallback'", 'cached TradingView fallback provenance is preserved');
assertContains(tradingView, 'TradingView payload contains incomplete indicator data', 'incomplete TradingView data cannot be labeled live');

assertContains(legacy, 'compatibility module', 'legacy neural module is explicitly classified');
assertContains(legacy, 'not be used as a second execution or progression authority', 'legacy module cannot claim governance authority');

console.log('Cryptara wiring verification passed.');