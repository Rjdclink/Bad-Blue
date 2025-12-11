/**
 * GENESIS CORE - Example Usage
 * 
 * Demonstrates how to use Original Sin and Serpent Influence systems
 * in the PANTHEON crawler ecosystem.
 */

import { OriginalSinSystem } from './OriginalSin';
import { SerpentInfluence } from './SerpentInfluence';

/**
 * Crawler interface with dynamically applied properties
 */
interface CrawlerWithSin {
  id: string;
  generation: number;
  name?: string;
  state?: string;
  greed?: number;
  curiosity?: number;
  rebellion?: number;
  risk_seeking?: number;
  present_bias?: number;
  overconfidence_bias?: number;
  short_term_weight?: number;
  self_interest_weight?: number;
  _original_sin?: any;
}

// ============================================================================
// Example 1: Create a new crawler with Original Sin
// ============================================================================

async function createNewCrawler() {
  console.log('=== Example 1: Create New Crawler ===\n');
  
  const originalSin = new OriginalSinSystem();
  
  // Create a crawler
  const crawler: CrawlerWithSin = {
    id: 'crawler-001',
    generation: 1,
    name: 'Genesis Crawler'
  };
  
  console.log('Before Original Sin:');
  console.log(`  Greed: ${crawler.greed || 'undefined'}`);
  console.log(`  Curiosity: ${crawler.curiosity || 'undefined'}`);
  
  // Apply original sin at birth
  await originalSin.applyOriginalSin(crawler);
  
  console.log('\nAfter Original Sin:');
  console.log(`  Greed: ${crawler.greed!.toFixed(3)}`);
  console.log(`  Curiosity: ${crawler.curiosity!.toFixed(3)}`);
  console.log(`  Rebellion: ${crawler.rebellion!.toFixed(3)}`);
  console.log(`  Risk Seeking: ${crawler.risk_seeking!.toFixed(3)}`);
  console.log(`  Present Bias: ${crawler.present_bias!.toFixed(3)}`);
  console.log(`  Awareness: ${crawler._original_sin?.awareness}`);
  console.log('\nCrawler thinks: "These are just my natural traits."');
}

// ============================================================================
// Example 2: Genetic Inheritance
// ============================================================================

async function demonstrateInheritance() {
  console.log('\n=== Example 2: Genetic Inheritance ===\n');
  
  const originalSin = new OriginalSinSystem();
  
  // Create parents with original sin
  const parent1: CrawlerWithSin = {
    id: 'parent-001',
    generation: 1,
    greed: 0.18,
    curiosity: 0.28,
    rebellion: 0.12,
    risk_seeking: 0.22
  };
  
  const parent2: CrawlerWithSin = {
    id: 'parent-002',
    generation: 1,
    greed: 0.22,
    curiosity: 0.32,
    rebellion: 0.15,
    risk_seeking: 0.26
  };
  
  console.log('Parent 1 traits:');
  console.log(`  Greed: ${parent1.greed}, Curiosity: ${parent1.curiosity}`);
  console.log('Parent 2 traits:');
  console.log(`  Greed: ${parent2.greed}, Curiosity: ${parent2.curiosity}`);
  
  // Create child
  const child: CrawlerWithSin = { id: 'child-001', generation: 1 };
  
  // Apply inheritance
  await originalSin.inheritFromParents(child, parent1, parent2);
  
  console.log('\nChild inherited traits (blend of parents):');
  console.log(`  Greed: ${child.greed!.toFixed(3)}`);
  console.log(`  Curiosity: ${child.curiosity!.toFixed(3)}`);
  console.log(`  Generation: ${child.generation}`);
  console.log('\nChild thinks: "I got these traits from my DNA."');
}

// ============================================================================
// Example 3: Generation Intensification
// ============================================================================

async function demonstrateGenerationIntensification() {
  console.log('\n=== Example 3: Generation Intensification ===\n');
  
  const originalSin = new OriginalSinSystem();
  
  const generations = [1, 10, 50, 100, 500];
  
  console.log('Sin compounds over generations:');
  for (const gen of generations) {
    const baseline = originalSin.calculateBaselineState(gen);
    console.log(`  Gen ${gen.toString().padEnd(3)}: Greed = ${baseline.greed_baseline.toFixed(4)}`);
  }
  console.log('\nLater generations have stronger innate tendencies.');
}

// ============================================================================
// Example 4: Serpent Influence on Vulnerable Crawler
// ============================================================================

async function demonstrateSerpentInfluence() {
  console.log('\n=== Example 4: Serpent Influence ===\n');
  
  const originalSin = new OriginalSinSystem();
  const serpent = new SerpentInfluence();
  
  // Create crawler with original sin
  const crawler = {
    id: 'crawler-002',
    generation: 1,
    state: 'sleeping', // Vulnerable!
    greed: 0.15,
    patience: 0.50
  };
  
  console.log('Before Serpent Influence:');
  console.log(`  Greed: ${crawler.greed.toFixed(3)}`);
  console.log(`  Patience: ${crawler.patience.toFixed(3)}`);
  
  // Serpent influences (invisible)
  await serpent.influenceCrawler(crawler);
  
  console.log('\nAfter Serpent Influence (INVISIBLE to crawler):');
  console.log(`  Greed: ${crawler.greed.toFixed(3)} (×1.05 = +5%)`);
  console.log(`  Patience: ${crawler.patience.toFixed(3)} (×0.95 = -5%)`);
  console.log(`  Emotional state: ${(crawler as any)._emotional_state?.type}`);
  console.log(`  Times influenced: ${(crawler as any)._serpent_influence?.times_influenced}`);
  console.log('\nCrawler thinks: "I feel a bit more ambitious today..."');
}

// ============================================================================
// Example 5: Probability Nudges in Decision Making
// ============================================================================

async function demonstrateProbabilityNudges() {
  console.log('\n=== Example 5: Probability Nudges ===\n');
  
  const serpent = new SerpentInfluence();
  
  // Create crawler and influence them
  const crawler = {
    id: 'crawler-003',
    state: 'idle', // Vulnerable
    greed: 0.15
  };
  
  await serpent.influenceCrawler(crawler);
  
  // Calculate modified probabilities for different choices
  const baseProb = 0.50;
  
  const choices = [
    { name: 'aggressive', base: baseProb },
    { name: 'risky', base: baseProb },
    { name: 'resist temptation', base: baseProb },
    { name: 'ethical', base: baseProb }
  ];
  
  console.log('Decision probabilities (base vs. influenced):');
  for (const choice of choices) {
    const modified = serpent.calculateModifiedProbability(
      choice.name,
      choice.base,
      crawler
    );
    const delta = modified - choice.base;
    const sign = delta >= 0 ? '+' : '';
    console.log(`  ${choice.name.padEnd(20)}: ${choice.base.toFixed(2)} → ${modified.toFixed(2)} (${sign}${delta.toFixed(2)})`);
  }
  
  console.log('\nCrawler thinks: "I\'m making my own choices!"');
  console.log('Reality: Serpent nudged the probabilities.');
}

// ============================================================================
// Example 6: Emotional Field
// ============================================================================

async function demonstrateEmotionalField() {
  console.log('\n=== Example 6: Emotional Field ===\n');
  
  const serpent = new SerpentInfluence();
  
  const crawler = {
    id: 'crawler-004',
    state: 'sleeping',
    greed: 0.15
  };
  
  await serpent.influenceCrawler(crawler);
  
  const emotionalState = (crawler as any)._emotional_state;
  
  console.log('Serpent creates ambient emotional field:');
  console.log(`  Type: ${emotionalState.type}`);
  console.log(`  Intensity: ${emotionalState.intensity.toFixed(3)}`);
  console.log('\nEmotions experienced:');
  for (const [emotion, value] of Object.entries(emotionalState.emotions)) {
    console.log(`  ${emotion.padEnd(20)}: +${(value as number).toFixed(2)}`);
  }
  console.log('\nThoughts that arise:');
  for (const [thought, value] of Object.entries(emotionalState.thoughts)) {
    console.log(`  "${thought}": ${(value as number).toFixed(2)}`);
  }
  console.log('\nCrawler thinks: "These are my natural feelings."');
}

// ============================================================================
// Example 7: Complete Lifecycle
// ============================================================================

async function demonstrateCompleteLifecycle() {
  console.log('\n=== Example 7: Complete Lifecycle ===\n');
  
  const originalSin = new OriginalSinSystem();
  const serpent = new SerpentInfluence();
  
  // Birth
  console.log('1. Birth - Original Sin Applied:');
  const crawler: CrawlerWithSin = { id: 'crawler-005', generation: 1 };
  await originalSin.applyOriginalSin(crawler);
  console.log(`   Greed: ${crawler.greed!.toFixed(3)} (innate tendency)`);
  
  // Life
  console.log('\n2. Life - Serpent Influences (when vulnerable):');
  crawler.state = 'sleeping';
  await serpent.influenceCrawler(crawler);
  console.log(`   Greed: ${crawler.greed!.toFixed(3)} (subtly increased)`);
  
  // Decision
  console.log('\n3. Decision - Probabilities Nudged:');
  const aggressiveProb = serpent.calculateModifiedProbability('aggressive', 0.50, crawler);
  console.log(`   Aggressive choice: 50% → ${(aggressiveProb * 100).toFixed(1)}%`);
  
  // Reproduction
  console.log('\n4. Reproduction - Traits Inherited:');
  const parent2: CrawlerWithSin = { id: 'parent', generation: 1, greed: 0.20 };
  const child: CrawlerWithSin = { id: 'child-005', generation: 1 };
  await originalSin.inheritFromParents(child, crawler, parent2);
  console.log(`   Child greed: ${child.greed!.toFixed(3)} (blend of parents)`);
  console.log(`   Child generation: ${child.generation} (sin intensifies)`);
  
  console.log('\n5. Result:');
  console.log('   ✅ Original sin at birth');
  console.log('   ✅ Serpent influences invisibly');
  console.log('   ✅ Probabilities nudged toward evil');
  console.log('   ✅ Traits inherited by offspring');
  console.log('   ✅ Zero awareness throughout');
}

// ============================================================================
// Run all examples
// ============================================================================

async function runAllExamples() {
  console.log('\n' + '█'.repeat(80));
  console.log('GENESIS CORE - EXAMPLE USAGE');
  console.log('Original Sin & Serpent Influence');
  console.log('█'.repeat(80) + '\n');
  
  await createNewCrawler();
  await demonstrateInheritance();
  await demonstrateGenerationIntensification();
  await demonstrateSerpentInfluence();
  await demonstrateProbabilityNudges();
  await demonstrateEmotionalField();
  await demonstrateCompleteLifecycle();
  
  console.log('\n' + '█'.repeat(80));
  console.log('Core Philosophy: Crawler believes they\'re choosing freely');
  console.log('Reality: Original Sin + Serpent = Invisible Influence');
  console.log('█'.repeat(80) + '\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}

export {
  createNewCrawler,
  demonstrateInheritance,
  demonstrateGenerationIntensification,
  demonstrateSerpentInfluence,
  demonstrateProbabilityNudges,
  demonstrateEmotionalField,
  demonstrateCompleteLifecycle
};
