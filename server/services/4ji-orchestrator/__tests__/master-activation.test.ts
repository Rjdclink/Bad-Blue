/**
 * Master Activation Test Suite
 * 
 * Tests for the 4JI Master Activation System
 */

import { MasterActivation } from '../master-activation.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Run master activation tests
 */
export async function runMasterActivationTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          MASTER ACTIVATION TEST SUITE                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Test 1: Creative directive content
  try {
    console.log('Test 1: Creative directive content...');
    const directive = MasterActivation.getCreativeDirective();
    
    const checks = [
      { term: 'boundless', found: directive.includes('boundless') },
      { term: 'hyper-evolved', found: directive.includes('hyper-evolved') },
      { term: 'transcendent', found: directive.includes('transcendent') },
      { term: 'quantum speed', found: directive.includes('quantum speed') },
      { term: 'recursive adaptive logic', found: directive.includes('recursive adaptive logic') },
      { term: 'self-optimization', found: directive.includes('self-optimization') },
    ];
    
    const allFound = checks.every(c => c.found);
    
    if (!allFound) {
      const missing = checks.filter(c => !c.found).map(c => c.term);
      throw new Error(`Missing directive terms: ${missing.join(', ')}`);
    }
    
    console.log('  ✅ PASSED - All creative directive elements present');
    results.push({ name: 'Creative directive content', passed: true });
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.push({ name: 'Creative directive content', passed: false, error: error.message });
  }

  // Test 2: Pre-activation status
  try {
    console.log('\nTest 2: Pre-activation status...');
    const isActivated = MasterActivation.isSystemActivated();
    
    if (isActivated !== false) {
      throw new Error(`Expected false, got ${isActivated}`);
    }
    
    console.log('  ✅ PASSED - System starts deactivated');
    results.push({ name: 'Pre-activation status', passed: true });
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.push({ name: 'Pre-activation status', passed: false, error: error.message });
  }

  // Test 3: Deactivation on non-activated system (should be safe)
  try {
    console.log('\nTest 3: Safe deactivation on non-activated system...');
    MasterActivation.deactivate();
    
    const stillDeactivated = MasterActivation.isSystemActivated();
    if (stillDeactivated !== false) {
      throw new Error('System should remain deactivated');
    }
    
    console.log('  ✅ PASSED - Deactivate is safe on non-activated system');
    results.push({ name: 'Safe deactivation', passed: true });
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.push({ name: 'Safe deactivation', passed: false, error: error.message });
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📊 Total:  ${results.length}`);

  if (failed > 0) {
    console.log('\n  Failures:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    - ${r.name}: ${r.error}`);
    });
  }

  console.log('\n');
  return results;
}

// Run if executed directly
const isDirectExecution = (() => {
  try {
    const scriptPath = process.argv[1];
    if (!scriptPath) return false;
    const fileUrl = new URL(import.meta.url);
    const scriptUrl = new URL(`file://${scriptPath}`);
    return fileUrl.pathname === scriptUrl.pathname;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  runMasterActivationTests()
    .then(results => {
      const failed = results.filter(r => !r.passed).length;
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}
