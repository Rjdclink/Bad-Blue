/**
 * Trinity Crawlers - Usage Examples
 * 
 * Demonstrates how to use Blizzard, Cerberus, Lich, Bird of Prey, and Six Degrees crawlers
 * for various intelligence gathering scenarios.
 */

import { BlizzardCrawler, CerberusCrawler, LichCrawler, BirdOfPreyCrawler, SixDegreesCrawler } from './index';
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
  await cerberus.loyalAttack('https://difficult-site.com', 100);
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
  await lich.castSpell('https://low-security.com', 'simple');
  console.log('Simple spell cast, power:', lich.powerLevel);

  await lich.castSpell('https://medium-security.com', 'complex');
  console.log('Complex spell cast, form:', lich.currentForm);

  await lich.castSpell('https://high-security.com', 'forbidden');
  console.log('Forbidden spell cast, souls:', lich.soulsHarvested);

  // Example 2: Command zombie army
  await lich.commandZombies('https://target.com');
  console.log('Zombie army deployed');

  // Example 3: Command ghost swarm
  await lich.commandGhosts('https://target.com');
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
    await cerberus.attack(target.target);
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

BIRD OF PREY:
- Need complete invisibility (perfect cloaking)
- Aggressive data extraction required
- Bypassing rate limits and shields
- Fire while cloaked capability
- Multiple attack patterns needed
- Budget: High, aggressive operations

COMBINED:
- Comprehensive intelligence gathering
- Multi-phase operations
- Adaptive approach based on target difficulty
*/

// ═══════════════════════════════════════════════════════════════════════════
// BIRD OF PREY CRAWLER - Klingon Predator Operations
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleBirdOfPrey() {
  const birdOfPrey = new BirdOfPreyCrawler(stealth, phylactery);

  // Example 1: Perfect cloaking device
  await birdOfPrey.perfectCloak();
  console.log('Cloaked status:', birdOfPrey.getStatus());
  console.log('Combat readiness:', birdOfPrey.getCombatReadiness());

  // Example 2: Fire while cloaked (advanced capability)
  const canFireCloaked = await birdOfPrey.fireWhileCloaked();
  console.log('Can fire while cloaked:', canFireCloaked);

  // Example 3: Disruptor weapons
  const target = 'https://target-site.com';
  
  // Standard disruptor (power 10)
  const disruptorData = await birdOfPrey.fireDisruptors(target, 10);
  console.log('Disruptor hit:', disruptorData.metadata.power, 'power level');

  // Overload disruptors (power 15)
  const overloadData = await birdOfPrey.overloadDisruptors(target);
  console.log('Overload hit:', overloadData.metadata.power, 'power level');

  // Photon torpedo (massive strike)
  const torpedoData = await birdOfPrey.photonTorpedo(target);
  console.log('Torpedo hit:', torpedoData.metadata.power, 'power level');

  // Example 4: Decloak Strike (Classic Klingon)
  const decloakResult = await birdOfPrey.decloakStrike(target);
  console.log('Decloak strike:', decloakResult.metadata.attackPattern);
  console.log('Steps:', decloakResult.metadata.steps);

  // Example 5: Ghost Strike (Never seen)
  const ghostResult = await birdOfPrey.ghostStrike(target);
  console.log('Ghost strike:', ghostResult.metadata.attackPattern);
  console.log('Remained cloaked:', ghostResult.metadata.remainedCloaked);
  console.log('Detection probability:', ghostResult.metadata.detectionProbability);

  // Example 6: Alpha Strike (Multiple targets)
  const targets = ['https://target1.com', 'https://target2.com', 'https://target3.com'];
  const alphaResults = await birdOfPrey.alphaStrike(targets);
  console.log('Alpha strike:', alphaResults.length, 'targets hit');
  console.log('Total targets:', alphaResults[0]?.metadata.totalTargets);

  // Example 7: Hunt (Stalk and strike)
  const huntResult = await birdOfPrey.hunt('https://prey-site.com');
  console.log('Hunt complete:', huntResult.metadata.attackPattern);
  console.log('Vulnerability score:', huntResult.metadata.vulnerabilityScore);
  console.log('Strike type:', huntResult.metadata.strikeType);

  // Example 8: Check final status
  const finalStatus = birdOfPrey.getStatus();
  console.log('Final status:', {
    cloaked: finalStatus.cloaked,
    killCount: finalStatus.killCount,
    aggression: finalStatus.aggression,
    ethics: finalStatus.ethics
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED OPERATIONS - Using All Four
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleCombinedWithBirdOfPrey() {
  const blizzard = new BlizzardCrawler(phylactery, stealth);
  const cerberus = new CerberusCrawler(phylactery, stealth);
  const lich = new LichCrawler(phylactery, stealth);
  const birdOfPrey = new BirdOfPreyCrawler(stealth, phylactery);

  // Scenario: Elite aggressive intelligence operation
  
  // Phase 1: Blizzard discovers targets
  console.log('Phase 1: Discovery');
  const discovered = await blizzard.triggerAvalanche('https://initial-target.com');
  console.log('Discovered', discovered.length, 'targets');

  // Phase 2: Bird of Prey hunts high-value targets with perfect stealth
  console.log('Phase 2: Klingon Predator Operations');
  const highValueTargets = discovered.filter(d => d.confidence > 0.8).slice(0, 5);
  for (const target of highValueTargets) {
    const huntResult = await birdOfPrey.hunt(target.target);
    console.log('Hunted:', target.target, 'strike type:', huntResult.metadata.strikeType);
  }

  // Phase 3: Cerberus handles medium-value targets reliably
  console.log('Phase 3: Reliable Collection');
  const mediumTargets = discovered.filter(d => d.confidence > 0.5 && d.confidence <= 0.8).slice(0, 10);
  for (const target of mediumTargets) {
    await cerberus.attack(target.target);
  }

  // Phase 4: Lich performs elite operations on protected targets
  console.log('Phase 4: Elite Operations');
  const protectedTargets = discovered.filter(d => d.confidence > 0.9).slice(0, 3);
  for (const target of protectedTargets) {
    await lich.castSpell(target.target, 'forbidden');
  }

  // Final: Check all metrics
  console.log('Bird of Prey status:', birdOfPrey.getStatus());
  console.log('Phylactery metrics:', phylactery.getMetrics());
}

// ═══════════════════════════════════════════════════════════════════════════
// SIX DEGREES CRAWLER - Relationship Mapping & Path Finding
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleSixDegrees() {
  const sixDegrees = new SixDegreesCrawler(stealth, phylactery);

  // Example 1: Build relationship graph
  console.log('Building graph from seed domain...');
  await sixDegrees.buildGraph('example.com', 3);
  const stats = sixDegrees.getGraphStats();
  console.log('Graph stats:', stats);
  console.log('- Nodes:', stats.nodeCount);
  console.log('- Edges:', stats.edgeCount);
  console.log('- Avg connections per node:', stats.avgConnections.toFixed(2));

  // Example 2: Find shortest path between two sites
  console.log('\nFinding shortest path...');
  const path = await sixDegrees.findPath('example.com', 'target.com');
  if (path.degrees > 0) {
    console.log('Path found!');
    console.log('- Degrees of separation:', path.degrees);
    console.log('- Path:', path.nodes.join(' -> '));
    console.log('- Relationship types:', path.relationships.map(r => r.type).join(', '));
  } else {
    console.log('No path found between domains');
  }

  // Example 3: Find all paths within N degrees
  console.log('\nFinding all paths within 4 degrees...');
  const allPaths = await sixDegrees.findAllPaths('example.com', 'target.com', 4);
  console.log('Found', allPaths.length, 'paths');
  allPaths.slice(0, 3).forEach((p, i) => {
    console.log(`Path ${i + 1}:`, p.nodes.join(' -> '), `(${p.degrees} degrees)`);
  });

  // Example 4: Discover communities
  console.log('\nDiscovering communities...');
  const communities = await sixDegrees.findCommunities();
  console.log('Found', communities.length, 'communities');
  communities.slice(0, 3).forEach((c, i) => {
    console.log(`Community ${i + 1}:`, c.id);
    console.log('- Members:', c.members.length);
    console.log('- Commonality:', c.commonality);
    console.log('- Density:', c.density.toFixed(2));
    console.log('- Sample members:', c.members.slice(0, 3).join(', '));
  });

  // Example 5: Find hubs
  console.log('\nIdentifying hubs...');
  const hubs = await sixDegrees.findHubs(5);
  console.log('Top', hubs.length, 'hubs:');
  hubs.forEach((hub, i) => {
    console.log(`${i + 1}. ${hub.domain}`);
    console.log('   - Connections:', hub.connections.length);
    console.log('   - Authority:', hub.authority.toFixed(2));
    console.log('   - Type:', hub.type);
  });

  // Example 6: Discover hidden sites
  console.log('\nDiscovering hidden sites...');
  const hidden = await sixDegrees.discoverHidden('example.com');
  console.log('Found', hidden.length, 'hidden/low-authority sites');
  console.log('Sample hidden sites:', hidden.slice(0, 5).join(', '));

  // Example 7: Crawl along path
  console.log('\nCrawling along path...');
  const pathData = await sixDegrees.crawlPath('example.com', 'target.com');
  console.log('Crawled', pathData.length, 'sites along the path');
  pathData.forEach((data, i) => {
    console.log(`Site ${i + 1}: ${data.target}`);
    console.log('- Confidence:', data.confidence);
    console.log('- Content length:', data.content.length);
  });

  // Example 8: Crawl entire community
  if (communities.length > 0) {
    console.log('\nCrawling first community...');
    const communityData = await sixDegrees.crawlCommunity(communities[0]);
    console.log('Crawled', communityData.length, 'sites in community');
    console.log('Total content gathered:', communityData.reduce((sum, d) => sum + d.content.length, 0), 'chars');
  }

  // Example 9: Exploit hub
  if (hubs.length > 0) {
    console.log('\nExploiting top hub...');
    const hubData = await sixDegrees.exploitHub(hubs[0].domain);
    console.log('Exploited hub:', hubs[0].domain);
    console.log('- Directly accessed:', hubData.length, 'sites');
    console.log('- Coverage:', hubs[0].connections.length, 'connected sites');
  }

  // Example 10: Final statistics
  console.log('\nFinal statistics:');
  const finalStats = sixDegrees.getGraphStats();
  console.log('Total network mapped:', finalStats.nodeCount, 'sites');
  console.log('Total relationships:', finalStats.edgeCount);
  console.log('Network density:', (finalStats.avgConnections / finalStats.nodeCount * 100).toFixed(1), '%');
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED OPERATIONS - Using All Five Crawlers
// ═══════════════════════════════════════════════════════════════════════════

export async function exampleCombinedWithSixDegrees() {
  const blizzard = new BlizzardCrawler(phylactery, stealth);
  const cerberus = new CerberusCrawler(phylactery, stealth);
  const lich = new LichCrawler(phylactery, stealth);
  const birdOfPrey = new BirdOfPreyCrawler(stealth, phylactery);
  const sixDegrees = new SixDegreesCrawler(stealth, phylactery);

  // Scenario: Strategic intelligence operation with relationship mapping
  
  // Phase 1: Six Degrees maps the network
  console.log('Phase 1: Network Mapping');
  await sixDegrees.buildGraph('initial-target.com', 4);
  const communities = await sixDegrees.findCommunities();
  const hubs = await sixDegrees.findHubs(10);
  console.log('Mapped network:', sixDegrees.getGraphStats().nodeCount, 'sites');
  console.log('Discovered', communities.length, 'communities');
  console.log('Identified', hubs.length, 'hubs');

  // Phase 2: Bird of Prey conducts stealth reconnaissance on hubs
  console.log('Phase 2: Stealth Reconnaissance');
  await birdOfPrey.perfectCloak();
  for (const hub of hubs.slice(0, 3)) {
    const huntResult = await birdOfPrey.hunt(hub.domain);
    console.log('Reconned hub:', hub.domain, 'vulnerability:', huntResult.metadata.vulnerabilityScore);
  }

  // Phase 3: Blizzard performs mass collection on communities
  console.log('Phase 3: Mass Collection');
  for (const community of communities.slice(0, 2)) {
    const targets = community.members.slice(0, 10);
    const results = await blizzard.deploy(targets, 'snow');
    console.log('Collected from community', community.id + ':', results.length, 'results');
  }

  // Phase 4: Cerberus reliably scrapes discovered paths
  console.log('Phase 4: Path-Based Collection');
  const path = await sixDegrees.findPath('initial-target.com', hubs[0]?.domain || 'example.com');
  if (path.degrees > 0) {
    for (const node of path.nodes) {
      await cerberus.attack(node);
    }
    console.log('Collected along path of', path.degrees, 'degrees');
  }

  // Phase 5: Lich performs elite operations on high-value targets
  console.log('Phase 5: Elite Operations');
  const highValueHubs = hubs.filter(h => h.authority > 0.8).slice(0, 3);
  for (const hub of highValueHubs) {
    await lich.castSpell(hub.domain, 'complex');
  }

  // Final: Comprehensive intelligence report
  console.log('\n=== INTELLIGENCE REPORT ===');
  console.log('Network topology:', sixDegrees.getGraphStats());
  console.log('Bird of Prey status:', birdOfPrey.getStatus());
  console.log('Phylactery metrics:', phylactery.getMetrics());
  console.log('Communities mapped:', communities.length);
  console.log('Strategic hubs identified:', hubs.length);
}
