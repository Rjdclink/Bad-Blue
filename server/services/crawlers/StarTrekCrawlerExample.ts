/**
 * Star Trek Crawler - Usage Examples
 * 
 * Demonstrates how to use the Federation Explorer
 */

import { StarTrekCrawler } from './StarTrekCrawler';

async function demonstrateStarTrekCrawler() {
  console.log('🚀 STAR TREK CRAWLER - Federation Explorer Demo\n');
  
  const crawler = new StarTrekCrawler();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PRIME DIRECTIVE CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('1️⃣ Prime Directive Controls');
  console.log('Current Prime Directive:', crawler.getPrimeDirective());
  
  // Try to use kill setting with Prime Directive enabled
  try {
    await crawler.setPhaserSetting(8);
  } catch (error) {
    console.log('❌ Cannot use kill settings with Prime Directive enabled');
  }
  
  // Disable Prime Directive for aggressive operations
  crawler.setPrimeDirective(false);
  await crawler.setPhaserSetting(8);
  console.log('✅ Kill setting enabled (Prime Directive disabled)\n');
  
  // Re-enable for ethical operations
  crawler.setPrimeDirective(true);
  console.log('✅ Prime Directive re-enabled (phaser auto-adjusted to stun)\n');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. WARP DRIVE - EXPLORATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('2️⃣ Warp Drive System');
  
  crawler.setWarpSpeed(7);
  console.log('Warp speed set to 7');
  
  // Near jump (10-100 domains)
  const nearTarget = await crawler.warpJump('near');
  console.log('Near warp jump:', nearTarget);
  
  // Far jump (1000-10000 domains)
  const farTarget = await crawler.warpJump('far');
  console.log('Far warp jump:', farTarget);
  
  // Galactic jump (random TLD)
  const galacticTarget = await crawler.warpJump('galactic');
  console.log('Galactic warp jump:', galacticTarget, '\n');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. TRANSPORTER SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('3️⃣ Transporter System');
  
  try {
    await crawler.beamTo('https://example.com');
    console.log('✅ Successfully beamed to deep URL');
  } catch (error) {
    console.log('❌ Transport failed (30% chance)');
  }
  
  // Emergency beam out
  await crawler.emergencyBeamOut();
  console.log('⚡ Emergency beam out executed\n');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SENSOR ARRAY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('4️⃣ Sensor Array');
  
  crawler.setWarpSpeed(3); // Smaller scan for demo
  const discovered = await crawler.longRangeScan();
  console.log(`Long-range scan discovered ${discovered.length} targets`);
  console.log('Sample targets:', discovered.slice(0, 3));
  
  const testUrl = 'https://httpbin.org/status/200';
  const lifeSigns = await crawler.detectLifeSigns(testUrl);
  console.log(`Life signs at ${testUrl}:`, lifeSigns ? '✅ Detected' : '❌ None', '\n');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PHASER SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('5️⃣ Phaser System');
  
  // Stun setting (gentle)
  await crawler.setPhaserSetting(3);
  console.log('Phaser set to level 3 (10-20 req/min)');
  
  const data = await crawler.firePhaser('https://httpbin.org/html');
  console.log('Phaser fired at target');
  console.log('- Content length:', data.content.length);
  console.log('- Confidence:', data.confidence);
  console.log('- Metadata:', data.metadata, '\n');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. MISSIONS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('6️⃣ Mission Operations');
  
  // Surgical strike
  console.log('Executing surgical strike...');
  const strikeResult = await crawler.surgicalStrike('https://httpbin.org/html');
  console.log('✅ Surgical strike complete');
  console.log('- Target:', strikeResult.target);
  console.log('- Confidence:', strikeResult.confidence);
  
  // Explore sector (commented out to avoid long execution)
  // console.log('\nExploring sector...');
  // const explorationResults = await crawler.explore('alpha-quadrant');
  // console.log(`✅ Exploration complete: ${explorationResults.length} targets analyzed`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. STATUS REPORT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n7️⃣ Ship Status Report');
  const status = crawler.getStatus();
  console.log('Warp Speed:', status.warpSpeed);
  console.log('Phaser Setting:', status.phaserSetting);
  console.log('Prime Directive:', status.primeDirective ? 'Enabled' : 'Disabled');
  console.log('Request Count:', status.requestCount);
  console.log('Last Request Time:', new Date(status.lastRequestTime).toISOString());
  
  console.log('\n🖖 Live long and prosper!');
}

// Run the demo (only when executed directly, not when imported)
// In ES modules, check if this is the main module
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isMainModule) {
  demonstrateStarTrekCrawler().catch(console.error);
}

export { demonstrateStarTrekCrawler };
