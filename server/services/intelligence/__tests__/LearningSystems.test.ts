/**
 * Learning Systems Test Suite
 * Tests for ZombieHiveMind and DarkMagicAI
 */

import { PhylacterySystem } from '../../storage/PhylacterySystem';
import { ZombieHiveMind, DarkMagicAI } from '../LearningSystems';
import type { DeathMemory } from '../../storage/PhylacterySystem';

async function testDeathRecording(): Promise<boolean> {
  console.log('\n🧟 Testing Death Recording...');
  try {
    const phylactery = new PhylacterySystem();
    const hiveMind = new ZombieHiveMind(phylactery);

    const death1: DeathMemory = {
      zombieId: 'zombie-001',
      target: 'test-site.com',
      causeOfDeath: 'captcha',
      timestamp: Date.now(),
      fingerprint: {
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        vendor: 'Google Inc.',
        languages: ['en-US'],
        screenResolution: '1920x1080',
        timezone: 'America/New_York'
      },
      requestCount: 15,
      sessionAge: 45000,
      triggerPattern: 'rapid-requests',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0'
    };

    await hiveMind.recordDeath(death1);
    console.log('✓ Death recorded successfully');

    const deaths = await hiveMind.queryDeaths('test-site.com');
    if (deaths.length !== 1) {
      throw new Error(`Expected 1 death, got ${deaths.length}`);
    }
    console.log('✓ Death query successful');

    return true;
  } catch (error) {
    console.error('✗ Death recording failed:', error);
    return false;
  }
}

async function testPatternAnalysis(): Promise<boolean> {
  console.log('\n📊 Testing Pattern Analysis...');
  try {
    const phylactery = new PhylacterySystem();
    const hiveMind = new ZombieHiveMind(phylactery);

    for (let i = 0; i < 3; i++) {
      const death: DeathMemory = {
        zombieId: `zombie-${i}`,
        target: 'pattern-test.com',
        causeOfDeath: i === 0 ? 'captcha' : 'rate-limit',
        timestamp: Date.now() + i * 1000,
        fingerprint: {
          userAgent: 'Mozilla/5.0',
          platform: 'Win32',
          vendor: 'Google Inc.',
          languages: ['en-US'],
          screenResolution: '1920x1080',
          timezone: 'America/New_York'
        },
        requestCount: 10 + i * 5,
        sessionAge: 30000 + i * 10000,
        triggerPattern: 'pattern-' + i,
        ipAddress: '1.2.3.' + i,
        userAgent: 'Mozilla/5.0'
      };
      await hiveMind.recordDeath(death);
    }

    const analysis = await hiveMind.analyzePatterns('pattern-test.com');
    console.log('✓ Pattern analysis completed');
    console.log(`  Total deaths: ${analysis.totalDeaths}`);
    console.log(`  Recommended max requests: ${analysis.recommendedMaxRequests}`);
    console.log(`  Confidence: ${analysis.confidence.toFixed(2)}`);

    if (analysis.totalDeaths !== 3) {
      throw new Error(`Expected 3 deaths, got ${analysis.totalDeaths}`);
    }

    if (analysis.confidence <= 0) {
      throw new Error('Confidence should be greater than 0');
    }

    return true;
  } catch (error) {
    console.error('✗ Pattern analysis failed:', error);
    return false;
  }
}

async function testStrategyGeneration(): Promise<boolean> {
  console.log('\n🎯 Testing Strategy Generation...');
  try {
    const phylactery = new PhylacterySystem();
    const hiveMind = new ZombieHiveMind(phylactery);

    const death: DeathMemory = {
      zombieId: 'zombie-strategy',
      target: 'strategy-test.com',
      causeOfDeath: 'captcha',
      timestamp: Date.now(),
      fingerprint: {
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        vendor: 'Google Inc.',
        languages: ['en-US'],
        screenResolution: '1920x1080',
        timezone: 'America/New_York'
      },
      requestCount: 20,
      sessionAge: 60000,
      triggerPattern: 'test-pattern',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0'
    };

    await hiveMind.recordDeath(death);
    const strategy = await hiveMind.generateStrategy('strategy-test.com');
    
    console.log('✓ Strategy generated successfully');
    console.log(`  Type: ${strategy.type}`);
    console.log(`  Max requests: ${strategy.maxRequests}`);
    console.log(`  Delay: ${strategy.minDelay}-${strategy.maxDelay}ms`);

    if (!strategy.name || !strategy.type) {
      throw new Error('Strategy missing required fields');
    }

    return true;
  } catch (error) {
    console.error('✗ Strategy generation failed:', error);
    return false;
  }
}

async function testResurrection(): Promise<boolean> {
  console.log('\n⚡ Testing Zombie Resurrection...');
  try {
    const phylactery = new PhylacterySystem();
    const hiveMind = new ZombieHiveMind(phylactery);

    const death: DeathMemory = {
      zombieId: 'zombie-dead',
      target: 'resurrection-test.com',
      causeOfDeath: 'ip-ban',
      timestamp: Date.now(),
      fingerprint: {
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        vendor: 'Google Inc.',
        languages: ['en-US'],
        screenResolution: '1920x1080',
        timezone: 'America/New_York'
      },
      requestCount: 25,
      sessionAge: 75000,
      triggerPattern: 'aggressive',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0'
    };

    await hiveMind.recordDeath(death);
    const enhanced = await hiveMind.resurrectZombie('resurrection-test.com', 5);

    console.log('✓ Zombie resurrected successfully');
    console.log(`  Generation: ${enhanced.generation}`);
    console.log(`  Power boost: ${enhanced.powerBoost.toFixed(2)}`);
    console.log(`  Wisdom: ${enhanced.wisdom}`);

    if (enhanced.generation !== 5) {
      throw new Error(`Expected generation 5, got ${enhanced.generation}`);
    }

    if (enhanced.powerBoost <= 1.0) {
      throw new Error('Power boost should be greater than 1.0');
    }

    return true;
  } catch (error) {
    console.error('✗ Resurrection failed:', error);
    return false;
  }
}

async function testDarkMagicAI(): Promise<boolean> {
  console.log('\n🔮 Testing Dark Magic AI...');
  try {
    const phylactery = new PhylacterySystem();
    const darkMagic = new DarkMagicAI(phylactery);

    await darkMagic.trackPerformance('strategy-1', true);
    await darkMagic.trackPerformance('strategy-1', true);
    await darkMagic.trackPerformance('strategy-1', false);

    const best = await darkMagic.getBestStrategy('strategy');
    if (best && Math.abs(best.successRate - 2/3) > 0.001) {
      throw new Error(`Expected success rate ~0.67, got ${best.successRate}`);
    }

    console.log('✓ Performance tracking works');

    const analysis = await darkMagic.analyzeTarget('ai-test.com');
    console.log('✓ AI analysis completed');
    console.log(`  Best time to attack: ${analysis.bestTimeToAttack}`);
    console.log(`  Success rate: ${(analysis.successRate * 100).toFixed(1)}%`);

    const evolved = await darkMagic.evolveStrategy('ai-test.com');
    console.log('✓ Strategy evolution completed');
    console.log(`  Name: ${evolved.name}`);
    console.log(`  Predicted success: ${(evolved.predictedSuccessRate * 100).toFixed(1)}%`);

    return true;
  } catch (error) {
    console.error('✗ Dark Magic AI failed:', error);
    return false;
  }
}

async function testFingerprintMutation(): Promise<boolean> {
  console.log('\n🎭 Testing Fingerprint Mutation...');
  try {
    const phylactery = new PhylacterySystem();
    const hiveMind = new ZombieHiveMind(phylactery);

    const oldFingerprint = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      platform: 'Win32',
      vendor: 'Google Inc.',
      languages: ['en-US'],
      screenResolution: '1920x1080',
      timezone: 'America/New_York'
    };

    const newFingerprint = hiveMind.mutateFingerprint(oldFingerprint);
    console.log('✓ Fingerprint mutated successfully');
    console.log(`  Old UA: ${oldFingerprint.userAgent.substring(0, 30)}...`);
    console.log(`  New UA: ${newFingerprint.userAgent.substring(0, 30)}...`);

    if (newFingerprint.vendor !== oldFingerprint.vendor) {
      console.log('  Note: Vendor changed (expected to stay same)');
    }

    return true;
  } catch (error) {
    console.error('✗ Fingerprint mutation failed:', error);
    return false;
  }
}

export async function runLearningSystemsTests(): Promise<boolean> {
  console.log('\n' + '='.repeat(80));
  console.log('LEARNING SYSTEMS TEST SUITE');
  console.log('='.repeat(80));

  const results = [
    await testDeathRecording(),
    await testPatternAnalysis(),
    await testStrategyGeneration(),
    await testResurrection(),
    await testDarkMagicAI(),
    await testFingerprintMutation()
  ];

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Status: ${passed === total ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(80) + '\n');

  return passed === total;
}

// Run tests if this file is executed directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  runLearningSystemsTests().then(passed => {
    process.exit(passed ? 0 : 1);
  }).catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}
