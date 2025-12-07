/**
 * Bird of Prey Crawler Tests
 * Tests for Klingon predator crawler with cloaking and disruptors
 */

import { BirdOfPreyCrawler } from '../BirdOfPreyCrawler';
import { PhylacterySystem } from '../../storage/PhylacterySystem';
import { StealthInfrastructure } from '../../stealth/StealthInfrastructure';

interface TestResult { name: string; passed: boolean; error?: string; }
const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function expect<T>(actual: T) {
  return {
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    }
  };
}

async function runTests() {
  console.log('🦅 Running Bird of Prey Crawler Tests...\n');

  const phylactery = new PhylacterySystem();
  const stealth = new StealthInfrastructure();
  const birdOfPrey = new BirdOfPreyCrawler(stealth, phylactery);

  // Test 1: Initial state
  await test('should initialize with correct default values', async () => {
    const status = birdOfPrey.getStatus();
    expect(status.cloaked).toBe(false);
    expect(status.cloakStrength).toBe(1.0);
    expect(status.aggression).toBe(0.95);
    expect(status.ethics).toBe(0.01);
    expect(status.primeDirective).toBe(0.0);
    expect(status.killCount).toBe(0);
  })();

  // Test 2: Engage cloak
  await test('should engage cloaking device', async () => {
    await birdOfPrey.engageCloak();
    const status = birdOfPrey.getStatus();
    expect(status.cloaked).toBe(true);
    expect(status.cloakStrength).toBe(1.0);
    expect(status.signatures).toBeGreaterThan(0);
  })();

  // Test 3: Perfect cloak
  await test('should engage perfect cloaking device', async () => {
    await birdOfPrey.perfectCloak();
    const status = birdOfPrey.getStatus();
    expect(status.cloaked).toBe(true);
    expect(status.cloakStrength).toBe(2.0);
  })();

  // Test 4: Fire while cloaked
  await test('should be able to fire while cloaked', async () => {
    const canFire = await birdOfPrey.fireWhileCloaked();
    expect(canFire).toBe(true);
  })();

  // Test 5: Disengage cloak
  await test('should disengage cloaking device', async () => {
    await birdOfPrey.disengage();
    const status = birdOfPrey.getStatus();
    expect(status.cloaked).toBe(false);
    expect(status.cloakStrength).toBe(0);
    expect(status.signatures).toBe(0);
  })();

  // Test 6: Combat readiness
  await test('should calculate combat readiness', async () => {
    await birdOfPrey.engageCloak();
    const readiness = birdOfPrey.getCombatReadiness();
    expect(readiness).toBeGreaterThan(0.5);
  })();

  // Test 7: Perfect cloak combat readiness
  await test('should have higher combat readiness with perfect cloak', async () => {
    await birdOfPrey.perfectCloak();
    const readiness = birdOfPrey.getCombatReadiness();
    expect(readiness).toBe(1.0);
  })();

  // Summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${results.length}\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  process.exit(0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
