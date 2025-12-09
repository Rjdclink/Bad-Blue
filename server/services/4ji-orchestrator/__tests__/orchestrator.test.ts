/**
 * 4JI Orchestrator Test Suite
 * 
 * Tests for:
 * - Domain isolation between LegalWhat and Crypto Crawler
 * - Unified orchestrator functionality
 * - Self-repair engine operation
 * - Cross-domain access prevention
 */

import {
  ForgeAI,
  DomainFirewall,
  Domain,
  LegalWhatOrchestrator,
  SelfRepairEngine,
  ErrorSeverity,
  ErrorCategory,
} from '../index.js';
import { TaskPriority } from '../../../aiTokenGovernor.js';

interface TestResults {
  passed: number;
  failed: number;
  errors: string[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Run the 4JI Orchestrator test suite
 */
export async function run4JITests(): Promise<TestResults> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       4JI ORCHESTRATOR SYSTEM TEST SUITE                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const results: TestResults = {
    passed: 0,
    failed: 0,
    errors: [],
  };

  // Reset before tests
  ForgeAI.reset();
  LegalWhatOrchestrator.reset();
  SelfRepairEngine.reset();

  // ============================================================================
  // Domain Firewall Tests
  // ============================================================================
  console.log('\n--- Domain Firewall Tests ---\n');

  // Test 1: Initialize with isolated domain contexts
  try {
    console.log('Test 1: DomainFirewall initialization...');
    DomainFirewall.initialize();
    
    const legalStats = DomainFirewall.getDomainStats(Domain.LEGAL_WHAT);
    const cryptoStats = DomainFirewall.getDomainStats(Domain.CRYPTO_CRAWLER);
    
    assert(legalStats.operationCount === 0, 'Legal operation count should be 0');
    assert(cryptoStats.operationCount === 0, 'Crypto operation count should be 0');
    
    console.log('  ✅ PASSED - Domain contexts initialized with isolation');
    results.passed++;
    DomainFirewall.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`DomainFirewall init: ${error.message}`);
    DomainFirewall.reset();
  }

  // Test 2: Cross-domain access prevention
  try {
    console.log('\nTest 2: Cross-domain access prevention...');
    DomainFirewall.initialize();
    
    let violationDetected = false;
    
    await DomainFirewall.executeInDomain(
      Domain.LEGAL_WHAT,
      'test-operation',
      async () => {
        try {
          DomainFirewall.executeInDomainSync(
            Domain.CRYPTO_CRAWLER,
            'illegal-cross-access',
            () => {}
          );
        } catch (e: any) {
          if (e.message.includes('FIREWALL')) {
            violationDetected = true;
          }
        }
      }
    );

    assert(violationDetected, 'Cross-domain access should be blocked');
    
    const violations = DomainFirewall.getViolations();
    assert(violations.length > 0, 'Violation should be recorded');
    assert(violations[0].blocked === true, 'Violation should be blocked');
    
    console.log('  ✅ PASSED - Cross-domain access blocked and recorded');
    results.passed++;
    DomainFirewall.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`Cross-domain test: ${error.message}`);
    DomainFirewall.reset();
  }

  // Test 3: Domain-specific state isolation
  try {
    console.log('\nTest 3: Domain-specific state isolation...');
    DomainFirewall.initialize();
    
    // Store in LegalWhat
    await DomainFirewall.executeInDomain(
      Domain.LEGAL_WHAT,
      'store-state',
      async () => {
        DomainFirewall.storeState(Domain.LEGAL_WHAT, 'testKey', 'legalValue');
      }
    );

    // Store in Crypto Crawler
    await DomainFirewall.executeInDomain(
      Domain.CRYPTO_CRAWLER,
      'store-state',
      async () => {
        DomainFirewall.storeState(Domain.CRYPTO_CRAWLER, 'testKey', 'cryptoValue');
      }
    );

    // Verify isolation
    await DomainFirewall.executeInDomain(
      Domain.LEGAL_WHAT,
      'verify-state',
      async () => {
        const value = DomainFirewall.getState<string>(Domain.LEGAL_WHAT, 'testKey');
        assert(value === 'legalValue', 'LegalWhat should have its own value');
      }
    );
    
    console.log('  ✅ PASSED - State is isolated per domain');
    results.passed++;
    DomainFirewall.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`State isolation: ${error.message}`);
    DomainFirewall.reset();
  }

  // Test 4: Operation count tracking
  try {
    console.log('\nTest 4: Operation count tracking per domain...');
    DomainFirewall.initialize();
    
    await DomainFirewall.executeInDomain(Domain.LEGAL_WHAT, 'op1', async () => {});
    await DomainFirewall.executeInDomain(Domain.LEGAL_WHAT, 'op2', async () => {});
    await DomainFirewall.executeInDomain(Domain.LEGAL_WHAT, 'op3', async () => {});
    await DomainFirewall.executeInDomain(Domain.CRYPTO_CRAWLER, 'op1', async () => {});

    const legalStats = DomainFirewall.getDomainStats(Domain.LEGAL_WHAT);
    const cryptoStats = DomainFirewall.getDomainStats(Domain.CRYPTO_CRAWLER);

    assert(legalStats.operationCount === 3, 'LegalWhat should have 3 operations');
    assert(cryptoStats.operationCount === 1, 'Crypto should have 1 operation');
    
    console.log('  ✅ PASSED - Operations tracked separately per domain');
    results.passed++;
    DomainFirewall.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`Operation tracking: ${error.message}`);
    DomainFirewall.reset();
  }

  // ============================================================================
  // ForgeAI Unified Orchestrator Tests
  // ============================================================================
  console.log('\n--- ForgeAI Unified Orchestrator Tests ---\n');

  // Test 5: ForgeAI initialization
  try {
    console.log('Test 5: ForgeAI initialization with AI models...');
    await ForgeAI.initialize();
    
    const status = ForgeAI.getStatus();
    
    assert(status.isInitialized === true, 'Should be initialized');
    assert(status.modelsLoaded > 10, 'Should have 10+ models loaded');
    
    console.log(`  ✅ PASSED - ForgeAI initialized with ${status.modelsLoaded} models`);
    results.passed++;
    ForgeAI.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`ForgeAI init: ${error.message}`);
    ForgeAI.reset();
  }

  // Test 6: ForgeAI task execution in LegalWhat domain
  try {
    console.log('\nTest 6: Task execution in LegalWhat domain...');
    await ForgeAI.start();
    
    const result = await ForgeAI.executeTask({
      id: 'test-legal-task',
      domain: Domain.LEGAL_WHAT,
      type: 'legal-consultation',
      priority: TaskPriority.HIGH_USER,
      requiredCapabilities: ['legal-analysis', 'reasoning'],
      prompt: 'Test legal consultation request',
    });

    assert(result.success === true, 'Task should succeed');
    assert(result.domain === Domain.LEGAL_WHAT, 'Domain should be LegalWhat');
    assert(result.modelsUsed.length > 0, 'Should use at least one model');
    
    console.log(`  ✅ PASSED - Task executed with models: ${result.modelsUsed.join(', ')}`);
    results.passed++;
    ForgeAI.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`LegalWhat task: ${error.message}`);
    ForgeAI.reset();
  }

  // Test 7: ForgeAI task execution in Crypto Crawler domain
  try {
    console.log('\nTest 7: Task execution in Crypto Crawler domain...');
    await ForgeAI.start();
    
    const result = await ForgeAI.executeTask({
      id: 'test-crypto-task',
      domain: Domain.CRYPTO_CRAWLER,
      type: 'market-analysis',
      priority: TaskPriority.MEDIUM_BACKGROUND,
      requiredCapabilities: ['trading-analysis', 'pattern-recognition'],
      prompt: 'Test market analysis request',
    });

    assert(result.success === true, 'Task should succeed');
    assert(result.domain === Domain.CRYPTO_CRAWLER, 'Domain should be CryptoCrawler');
    
    console.log('  ✅ PASSED - Crypto Crawler task executed successfully');
    results.passed++;
    ForgeAI.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`CryptoCrawler task: ${error.message}`);
    ForgeAI.reset();
  }

  // Test 8: Evolution cycles
  try {
    console.log('\nTest 8: Independent evolution cycles...');
    await ForgeAI.start();
    
    await ForgeAI.triggerEvolution(Domain.LEGAL_WHAT);
    await ForgeAI.triggerEvolution(Domain.CRYPTO_CRAWLER);

    const status = ForgeAI.getStatus();
    
    assert(status.legalwhatStats.evolutionCycles === 1, 'LegalWhat should have 1 evolution');
    assert(status.cryptocrawlerStats.evolutionCycles === 1, 'Crypto should have 1 evolution');
    
    console.log('  ✅ PASSED - Evolution cycles tracked independently');
    results.passed++;
    ForgeAI.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`Evolution cycles: ${error.message}`);
    ForgeAI.reset();
  }

  // ============================================================================
  // LegalWhatOrchestrator Tests
  // ============================================================================
  console.log('\n--- LegalWhatOrchestrator Tests ---\n');

  // Test 9: LegalWhat initialization
  try {
    console.log('Test 9: LegalWhatOrchestrator initialization...');
    await LegalWhatOrchestrator.initialize();
    
    const status = LegalWhatOrchestrator.getStatus();
    
    assert(status.subAgentsActive > 0, 'Should have active sub-agents');
    assert(status.workerFunctionsActive > 0, 'Should have worker functions');
    
    console.log(`  ✅ PASSED - ${status.subAgentsActive} sub-agents, ${status.workerFunctionsActive} workers`);
    results.passed++;
    LegalWhatOrchestrator.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`LegalWhat init: ${error.message}`);
    LegalWhatOrchestrator.reset();
  }

  // Test 10: Legal consultation processing
  try {
    console.log('\nTest 10: Legal consultation processing...');
    await LegalWhatOrchestrator.start();
    
    const result = await LegalWhatOrchestrator.processConsultation({
      id: 'test-consult',
      situation: 'Test civil rights situation',
      lawType: 'civil-rights',
      jurisdiction: 'federal',
      urgency: 'high',
    });

    assert(result.requestId === 'test-consult', 'Request ID should match');
    assert(result.analysis.length > 0, 'Should have analysis');
    assert(result.confidenceLevel > 0, 'Should have confidence level');
    
    console.log(`  ✅ PASSED - Consultation processed with ${result.confidenceLevel.toFixed(2)} confidence`);
    results.passed++;
    LegalWhatOrchestrator.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`Consultation: ${error.message}`);
    LegalWhatOrchestrator.reset();
  }

  // ============================================================================
  // SelfRepairEngine Tests
  // ============================================================================
  console.log('\n--- SelfRepairEngine Tests ---\n');

  // Test 11: Self-repair initialization
  try {
    console.log('Test 11: SelfRepairEngine initialization...');
    SelfRepairEngine.initialize();
    
    const legalStats = SelfRepairEngine.getStatistics(Domain.LEGAL_WHAT);
    const cryptoStats = SelfRepairEngine.getStatistics(Domain.CRYPTO_CRAWLER);
    
    assert(legalStats.totalAnomalies === 0, 'Legal should have 0 anomalies');
    assert(cryptoStats.totalAnomalies === 0, 'Crypto should have 0 anomalies');
    
    console.log('  ✅ PASSED - Self-repair engine initialized per domain');
    results.passed++;
    SelfRepairEngine.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`SelfRepair init: ${error.message}`);
    SelfRepairEngine.reset();
  }

  // Test 12: Anomaly detection per domain
  try {
    console.log('\nTest 12: Anomaly detection per domain...');
    SelfRepairEngine.initialize();
    
    SelfRepairEngine.detectAnomaly(Domain.LEGAL_WHAT, {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.RUNTIME_ERROR,
      description: 'Test error in legal domain',
      affectedComponent: 'test',
    });

    SelfRepairEngine.detectAnomaly(Domain.CRYPTO_CRAWLER, {
      severity: ErrorSeverity.LOW,
      category: ErrorCategory.TRADING_ERROR,
      description: 'Test error in crypto domain',
      affectedComponent: 'test',
    });

    const legalAnomalies = SelfRepairEngine.getAnomalies(Domain.LEGAL_WHAT);
    const cryptoAnomalies = SelfRepairEngine.getAnomalies(Domain.CRYPTO_CRAWLER);

    assert(legalAnomalies.length === 1, 'Legal should have 1 anomaly');
    assert(cryptoAnomalies.length === 1, 'Crypto should have 1 anomaly');
    assert(legalAnomalies[0].category === ErrorCategory.RUNTIME_ERROR, 'Legal category check');
    assert(cryptoAnomalies[0].category === ErrorCategory.TRADING_ERROR, 'Crypto category check');
    
    console.log('  ✅ PASSED - Anomalies detected and categorized per domain');
    results.passed++;
    SelfRepairEngine.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`Anomaly detection: ${error.message}`);
    SelfRepairEngine.reset();
  }

  // ============================================================================
  // Complete System Isolation Test
  // ============================================================================
  console.log('\n--- Complete System Isolation Test ---\n');

  // Test 13: Full system health
  try {
    console.log('Test 13: Complete system health and isolation...');
    await ForgeAI.start();
    
    const status = ForgeAI.getStatus();
    
    assert(status.systemHealth >= 80, 'System health should be >= 80');
    assert(status.isInitialized === true, 'Should be initialized');
    assert(status.isRunning === true, 'Should be running');
    
    const isolation = DomainFirewall.verifyIsolation();
    assert(isolation.isIsolated === true, 'Domains should be isolated');
    
    console.log(`  ✅ PASSED - System health: ${status.systemHealth}%, Isolation: verified`);
    results.passed++;
    ForgeAI.reset();
  } catch (error: any) {
    console.log(`  ❌ FAILED - ${error.message}`);
    results.failed++;
    results.errors.push(`System health: ${error.message}`);
    ForgeAI.reset();
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  📊 Total:  ${results.passed + results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\n  Errors:');
    results.errors.forEach(e => console.log(`    - ${e}`));
  }

  console.log('\n');

  // Final cleanup
  ForgeAI.reset();
  LegalWhatOrchestrator.reset();
  SelfRepairEngine.reset();

  return results;
}

// Run if executed directly - using URL comparison for ESM modules
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
  run4JITests()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}
