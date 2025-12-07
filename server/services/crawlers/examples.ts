/**
 * Trinity Crawlers - Usage Examples
 * 
 * Demonstrates how to use Blizzard, Cerberus, and Lich crawlers
 * for various intelligence gathering scenarios.
 */

import { BlizzardCrawler, CerberusCrawler, LichCrawler } from './TrinityCrawlers';
import { PhylacterySystem } from '../storage/PhylacterySystem';
import { StealthInfrastructure } from '../stealth/StealthInfrastructure';

// Initialize shared systems
const phylactery = new PhylacterySystem();
const stealth = new StealthInfrastructure();

// ═══════════════════════════════════════════════════════════════════════════
// BLIZZARD CRAWLER - Mass Data Collection
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleBlizzard() {
  const blizzard = new BlizzardCrawler(phylactery, stealth);

  // Example 1: Generate unique snowflakes
  const snowflake1 = blizzard.generateSnowflake('https://example.com');
  const snowflake2 = blizzard.generateSnowflake('https://example.com');
  console.log('Snowflakes are unique:', snowflake1.id !== snowflake2.id);

  // Example 2: Deploy with different intensities
  const targets = ['site1.com', 'site2.com', 'site3.com'];
  
  // Light scraping
  const flurryResults = await blizzard.deploy(targets, 'flurry');
  console.log('Flurry results:', flurryResults.length);

  // Medium scraping
  const snowResults = await blizzard.deploy(targets, 'snow');
  console.log('Snow results:', snowResults.length);

  // Heavy scraping
  const blizzardResults = await blizzard.deploy(targets, 'blizzard');
  console.log('Blizzard results:', blizzardResults.length);

  // Example 3: Avalanche cascade scraping
  const cascadeResults = await blizzard.triggerAvalanche('https://initial-site.com');
  console.log('Cascade discovered:', cascadeResults.length, 'related sites');
}

// ═══════════════════════════════════════════════════════════════════════════
// CERBERUS CRAWLER - Reliable Multi-Strategy Scraping
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleCerberus() {
  const cerberus = new CerberusCrawler(phylactery, stealth);

  // Example 1: Three-headed simultaneous attack
  const data = await cerberus.attack('https://target-site.com');
  console.log('Attack succeeded via:', data.headUsed);

  // Example 2: Loyal attack - never gives up
  const difficultData = await cerberus.loyalAttack('https://difficult-site.com', 100);
  console.log('Loyal attack succeeded after retries');

  // Example 3: Monitor head performance
  const metrics = cerberus.getMetrics();
  console.log('Ice head success rate:', metrics.leftHead.successRate);
  console.log('Hydra head latency:', metrics.centerHead.averageLatency);
  console.log('Zombie head usage:', metrics.rightHead.usageCount);

  // Example 4: Regenerate failed heads
  await cerberus.regenerateHead('hydra');
  console.log('Hydra head regenerated with fresh sub-heads');
}

// ═══════════════════════════════════════════════════════════════════════════
// LICH CRAWLER - Elite Intelligence Operations
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleLich() {
  const lich = new LichCrawler(phylactery, stealth);

  // Example 1: Cast spells of different power levels
  const simpleData = await lich.castSpell('https://low-security.com', 'simple');
  console.log('Simple spell cast, power:', lich.powerLevel);

  const complexData = await lich.castSpell('https://medium-security.com', 'complex');
  console.log('Complex spell cast, form:', lich.currentForm);

  const forbiddenData = await lich.castSpell('https://high-security.com', 'forbidden');
  console.log('Forbidden spell cast, souls:', lich.soulsHarvested);

  // Example 2: Command zombie army
  const zombieData = await lich.commandZombies('https://target.com');
  console.log('Zombie army deployed');

  // Example 3: Command ghost swarm
  const ghostData = await lich.commandGhosts('https://target.com');
  console.log('Ghost swarm spawned');

  // Example 4: Check Lich status
  const status = lich.getStatus();
  console.log('Lich status:', {
    power: status.powerLevel,
    age: status.lichAge,
    form: status.currentForm,
    souls: status.soulsHarvested,
    zombieStrength: status.zombieStrength
  });

  // Example 5: Resurrection from phylactery
  const lichId = 'lich-primary';
  const resurrected = await lich.reformFromPhylactery(lichId);
  console.log('Lich resurrected:', resurrected);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED OPERATIONS - Using All Three
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleCombined() {
  const blizzard = new BlizzardCrawler(phylactery, stealth);
  const cerberus = new CerberusCrawler(phylactery, stealth);
  const lich = new LichCrawler(phylactery, stealth);

  // Scenario: Comprehensive intelligence gathering
  
  // Phase 1: Blizzard discovers targets
  console.log('Phase 1: Discovery');
  const discovered = await blizzard.triggerAvalanche('https://initial-target.com');
  console.log('Discovered', discovered.length, 'targets');

  // Phase 2: Cerberus reliably scrapes each target
  console.log('Phase 2: Reliable Collection');
  for (const target of discovered.slice(0, 10)) {
    const data = await cerberus.attack(target.target);
    console.log('Collected:', target.target);
  }

  // Phase 3: Lich performs elite operations on high-value targets
  console.log('Phase 3: Elite Operations');
  const highValueTargets = discovered.filter(d => d.confidence > 0.8);
  for (const target of highValueTargets.slice(0, 5)) {
    await lich.castSpell(target.target, 'complex');
  }

  // Final: Check phylactery metrics
  const metrics = phylactery.getMetrics();
  console.log('Final Metrics:', {
    iceCacheSize: metrics.iceCache.entries,
    soulsHarvested: metrics.lichSouls.count,
    totalPower: metrics.lichSouls.power
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// USAGE PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/*
WHEN TO USE EACH CRAWLER:

BLIZZARD:
- Need to scrape many targets quickly
- Want to discover related sites
- Volume over precision
- Budget: Low per request, high total

CERBERUS:
- Need reliable data extraction
- Site has anti-bot defenses
- Can't afford to fail
- Budget: Medium, retries included

LICH:
- High-value targets
- Need sophisticated strategies
- Learning from past attempts
- Budget: High, elite operations

COMBINED:
- Comprehensive intelligence gathering
- Multi-phase operations
- Adaptive approach based on target difficulty
*/
