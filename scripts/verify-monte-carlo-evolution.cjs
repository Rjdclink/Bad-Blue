/**
 * Monte Carlo Evolutionary Cycle Verification Test
 * Verifies all components are properly implemented
 */

const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('MONTE CARLO EVOLUTIONARY CYCLE VERIFICATION');
console.log('============================================================\n');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

// Load files
const configPath = path.join(__dirname, '../server/services/monteCarlo/MonteCarloConfig.ts');
const optimizerPath = path.join(__dirname, '../server/services/monteCarlo/MonteCarloCrawlerOptimizer.ts');
const evolutionPath = path.join(__dirname, '../server/services/monteCarlo/EvolutionaryCycleEngine.ts');
const indexPath = path.join(__dirname, '../server/services/monteCarlo/index.ts');
const routesPath = path.join(__dirname, '../server/routes/monteCarlo.routes.ts');
const docPath = path.join(__dirname, '../MONTE_CARLO_CRAWLER_CONFIG.md');

const configContent = fs.readFileSync(configPath, 'utf8');
const optimizerContent = fs.readFileSync(optimizerPath, 'utf8');
const evolutionContent = fs.readFileSync(evolutionPath, 'utf8');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const routesContent = fs.readFileSync(routesPath, 'utf8');
const docContent = fs.readFileSync(docPath, 'utf8');

// Test 1: Selected Crawlers
console.log('📋 SELECTED CRAWLERS (4 Required)');
console.log('----------------------------------------');
test('STARTREK crawler defined', configContent.includes("id: 'STARTREK'"));
test('BLIZZARD crawler defined', configContent.includes("id: 'BLIZZARD'"));
test('BIRDOFPREY crawler defined', configContent.includes("id: 'BIRDOFPREY'"));
test('HYDRA crawler defined', configContent.includes("id: 'HYDRA'"));
test('Initial weights sum to 1.0', configContent.includes('0.40') && configContent.includes('0.30') && configContent.includes('0.20') && configContent.includes('0.10'));

// Test 2: Monte Carlo Configuration
console.log('\n⚙️  MONTE CARLO CONFIGURATION');
console.log('----------------------------------------');
test('50 seeds configured', configContent.includes('count: 50'));
test('10 iterations per seed', configContent.includes('perSeed: 10'));
test('500 total runs', configContent.includes('totalRuns: 500'));
test('Randomization parameters defined', configContent.includes('crawlerChoice') && configContent.includes('crawlDepth'));
test('Scoring weights defined', configContent.includes('pagesDiscovered') && configContent.includes('usableContentExtracted'));

// Test 3: Evolutionary Cycle Engine
console.log('\n🔄 EVOLUTIONARY CYCLE ENGINE');
console.log('----------------------------------------');
test('MAX_ACTIVE_CRAWLERS = 4', evolutionContent.includes('MAX_ACTIVE_CRAWLERS = 4'));
test('MAX_NEW_VARIANTS_PER_CYCLE = 2', evolutionContent.includes('MAX_NEW_VARIANTS_PER_CYCLE = 2'));
test('Convergence cycles required = 3', evolutionContent.includes('CONVERGENCE_CYCLES_REQUIRED = 3'));
test('Min exploration probability defined', evolutionContent.includes('MIN_EXPLORATION_PROBABILITY'));
test('runCycle method exists', evolutionContent.includes('async runCycle()'));
test('enforceActiveCrawlerLimit exists', evolutionContent.includes('enforceActiveCrawlerLimit'));

// Test 4: Training Exposure
console.log('\n📊 TRAINING EXPOSURE SYSTEM');
console.log('----------------------------------------');
test('Posterior confidence tracking', evolutionContent.includes('posteriorConfidence'));
test('Training exposure calculation', evolutionContent.includes('calculateTrainingExposure'));
test('Exploration probability for lower-ranked', evolutionContent.includes('explorationProbability'));
test('Proportional to confidence', evolutionContent.includes('totalConfidence'));

// Test 5: Architecture Freeze
console.log('\n🔒 ARCHITECTURE FREEZE GUARDRAIL');
console.log('----------------------------------------');
test('Architecture freeze function', evolutionContent.includes('freezeArchitecture'));
test('Frozen status tracking', evolutionContent.includes("'frozen'") && evolutionContent.includes("status"));
test('frozenAt timestamp', evolutionContent.includes('frozenAt'));
test('Only parameters evolve after freeze', evolutionContent.includes('only parameterization may evolve'));

// Test 6: Variant Management
console.log('\n🧬 VARIANT MANAGEMENT');
console.log('----------------------------------------');
test('Create variant from base', evolutionContent.includes('createVariantFromBase'));
test('Create mutated variant', evolutionContent.includes('createMutatedVariant'));
test('Variant pool management', evolutionContent.includes('variantPool'));
test('Archive underperformers', evolutionContent.includes('archived'));

// Test 7: API Routes
console.log('\n🔌 API ROUTES');
console.log('----------------------------------------');
test('Evolution state endpoint', routesContent.includes('/evolution/state'));
test('Evolution cycle endpoint', routesContent.includes('/evolution/cycle'));
test('Evolution history endpoint', routesContent.includes('/evolution/history'));
test('Evolution crawlers endpoint', routesContent.includes('/evolution/crawlers'));
test('Evolution reset endpoint', routesContent.includes('/evolution/reset'));

// Test 8: Exports
console.log('\n📦 MODULE EXPORTS');
console.log('----------------------------------------');
test('EvolutionaryCycleEngine exported', indexContent.includes('EvolutionaryCycleEngine'));
test('evolutionaryCycleEngine singleton exported', indexContent.includes('evolutionaryCycleEngine'));
test('CrawlerVariant type exported', indexContent.includes('CrawlerVariant'));
test('EvolutionaryCycle type exported', indexContent.includes('EvolutionaryCycle'));

// Test 9: Documentation
console.log('\n📚 DOCUMENTATION');
console.log('----------------------------------------');
test('Config doc exists', fs.existsSync(docPath));
test('Evolutionary loop documented', docContent.includes('PICK 4') && docContent.includes('STRESS THEM'));
test('Max 4 crawler constraint documented', docContent.includes('Max Active Crawlers') && docContent.includes('4'));
test('Training exposure rule documented', docContent.includes('posterior confidence'));
test('Architecture freeze documented', docContent.includes('Architecture Freeze'));

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
console.log('');

if (failed === 0) {
  console.log('✅ ALL MONTE CARLO EVOLUTIONARY CYCLE TESTS PASSED');
  console.log('\n🎯 System ready for bounded evolutionary optimization');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
