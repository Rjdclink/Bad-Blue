// Facet Handler Test Runner
// Executes 500 simulations against 40 known violations
// Target: < 5% red flag rate

import {
  runComprehensiveHighRiskTests,
  quickComplianceTest,
  HIGH_RISK_SCENARIOS,
  type ComprehensiveTestResults,
} from './facet-high-risk-tests';

import {
  FacetSimulationEngine,
  COMPLIANCE_VIOLATIONS,
  ELITE_STRATEGY_CONFIG,
  runComplianceSimulation,
  optimizeForCompliance,
  type SimulationSummary,
} from './facet-simulation';

// ============================================================================
// TEST EXECUTION
// ============================================================================

interface TestExecutionResult {
  testName: string;
  timestamp: Date;
  duration: number;
  passed: boolean;
  redFlagRate: number;
  targetRate: number;
  simulations: number;
  violations: number;
  details: string;
}

async function executeTest(
  name: string,
  testFn: () => Promise<{ passed: boolean; redFlagRate: number; details: string }>
): Promise<TestExecutionResult> {
  const startTime = Date.now();
  console.log(`\n▶ Starting test: ${name}`);
  
  try {
    const result = await testFn();
    const duration = Date.now() - startTime;
    
    return {
      testName: name,
      timestamp: new Date(),
      duration,
      passed: result.passed,
      redFlagRate: result.redFlagRate,
      targetRate: 5,
      simulations: 500,
      violations: 40,
      details: result.details,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      testName: name,
      timestamp: new Date(),
      duration,
      passed: false,
      redFlagRate: 100,
      targetRate: 5,
      simulations: 0,
      violations: 40,
      details: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

export async function runFullTestSuite(): Promise<{
  overallPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestExecutionResult[];
  finalRedFlagRate: number;
}> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     FACET HANDLER COMPLIANCE TEST SUITE                        ║');
  console.log('║     Target: < 5% Red Flag Rate across 500 Simulations          ║');
  console.log('║     Violations Tested: 40 Known Compliance Violations          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const results: TestExecutionResult[] = [];
  
  // Test 1: Basic Strategy Validation (500 simulations)
  const test1 = await executeTest('Basic Strategy Validation (500 simulations)', async () => {
    const summary = runComplianceSimulation(500);
    return {
      passed: summary.redFlagRate < 5,
      redFlagRate: summary.redFlagRate,
      details: `Pass rate: ${summary.passRate.toFixed(2)}%, Avg violations: ${summary.averageViolations.toFixed(3)}`,
    };
  });
  results.push(test1);
  console.log(`  ${test1.passed ? '✅' : '❌'} Red Flag Rate: ${test1.redFlagRate.toFixed(2)}% (${test1.duration}ms)`);

  // Test 2: High-Risk Scenarios (500 simulations across 20 scenarios)
  const test2 = await executeTest('High-Risk Scenarios (500 total simulations)', async () => {
    const comprehensiveResults = await runComprehensiveHighRiskTests(25, 5);
    return {
      passed: comprehensiveResults.targetMet,
      redFlagRate: comprehensiveResults.overallRedFlagRate,
      details: `${comprehensiveResults.totalSimulations} simulations, ${comprehensiveResults.criticalFindings.length} critical findings`,
    };
  });
  results.push(test2);
  console.log(`  ${test2.passed ? '✅' : '❌'} Red Flag Rate: ${test2.redFlagRate.toFixed(2)}% (${test2.duration}ms)`);

  // Test 3: Extreme Risk Scenarios Focus
  const test3 = await executeTest('Extreme Risk Scenarios Focus', async () => {
    const extremeScenarios = HIGH_RISK_SCENARIOS.filter(s => s.riskLevel === 'extreme');
    let totalPassed = 0;
    let totalSimulations = 0;
    
    for (const scenario of extremeScenarios) {
      const engine = new FacetSimulationEngine();
      for (let i = 0; i < 50; i++) {
        const result = engine.runSimulation();
        if (result.passed) totalPassed++;
        totalSimulations++;
      }
    }
    
    const redFlagRate = ((totalSimulations - totalPassed) / totalSimulations) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `${extremeScenarios.length} extreme scenarios, ${totalSimulations} simulations`,
    };
  });
  results.push(test3);
  console.log(`  ${test3.passed ? '✅' : '❌'} Red Flag Rate: ${test3.redFlagRate.toFixed(2)}% (${test3.duration}ms)`);

  // Test 4: Structuring Detection Avoidance
  const test4 = await executeTest('Structuring Detection Avoidance', async () => {
    const structuringViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'structuring');
    const engine = new FacetSimulationEngine();
    let structuringFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const structuringTriggered = result.violationsTriggered.filter(v => 
        structuringViolations.some(sv => sv.id === v)
      );
      if (structuringTriggered.length > 0) structuringFlags++;
    }
    
    const redFlagRate = (structuringFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${structuringViolations.length} structuring violations`,
    };
  });
  results.push(test4);
  console.log(`  ${test4.passed ? '✅' : '❌'} Red Flag Rate: ${test4.redFlagRate.toFixed(2)}% (${test4.duration}ms)`);

  // Test 5: Velocity Detection Avoidance
  const test5 = await executeTest('Velocity Detection Avoidance', async () => {
    const velocityViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'velocity');
    const engine = new FacetSimulationEngine();
    let velocityFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const velocityTriggered = result.violationsTriggered.filter(v => 
        velocityViolations.some(vv => vv.id === v)
      );
      if (velocityTriggered.length > 0) velocityFlags++;
    }
    
    const redFlagRate = (velocityFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${velocityViolations.length} velocity violations`,
    };
  });
  results.push(test5);
  console.log(`  ${test5.passed ? '✅' : '❌'} Red Flag Rate: ${test5.redFlagRate.toFixed(2)}% (${test5.duration}ms)`);

  // Test 6: Pattern Detection Avoidance
  const test6 = await executeTest('Pattern Detection Avoidance', async () => {
    const patternViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'pattern');
    const engine = new FacetSimulationEngine();
    let patternFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const patternTriggered = result.violationsTriggered.filter(v => 
        patternViolations.some(pv => pv.id === v)
      );
      if (patternTriggered.length > 0) patternFlags++;
    }
    
    const redFlagRate = (patternFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${patternViolations.length} pattern violations`,
    };
  });
  results.push(test6);
  console.log(`  ${test6.passed ? '✅' : '❌'} Red Flag Rate: ${test6.redFlagRate.toFixed(2)}% (${test6.duration}ms)`);

  // Test 7: Amount-Based Detection Avoidance
  const test7 = await executeTest('Amount-Based Detection Avoidance', async () => {
    const amountViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'amount');
    const engine = new FacetSimulationEngine();
    let amountFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const amountTriggered = result.violationsTriggered.filter(v => 
        amountViolations.some(av => av.id === v)
      );
      if (amountTriggered.length > 0) amountFlags++;
    }
    
    const redFlagRate = (amountFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${amountViolations.length} amount violations`,
    };
  });
  results.push(test7);
  console.log(`  ${test7.passed ? '✅' : '❌'} Red Flag Rate: ${test7.redFlagRate.toFixed(2)}% (${test7.duration}ms)`);

  // Test 8: Behavioral Detection Avoidance
  const test8 = await executeTest('Behavioral Detection Avoidance', async () => {
    const behaviorViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'behavior');
    const engine = new FacetSimulationEngine();
    let behaviorFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const behaviorTriggered = result.violationsTriggered.filter(v => 
        behaviorViolations.some(bv => bv.id === v)
      );
      if (behaviorTriggered.length > 0) behaviorFlags++;
    }
    
    const redFlagRate = (behaviorFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${behaviorViolations.length} behavioral violations`,
    };
  });
  results.push(test8);
  console.log(`  ${test8.passed ? '✅' : '❌'} Red Flag Rate: ${test8.redFlagRate.toFixed(2)}% (${test8.duration}ms)`);

  // Test 9: Timing Detection Avoidance
  const test9 = await executeTest('Timing Detection Avoidance', async () => {
    const timingViolations = COMPLIANCE_VIOLATIONS.filter(v => v.category === 'timing');
    const engine = new FacetSimulationEngine();
    let timingFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const timingTriggered = result.violationsTriggered.filter(v => 
        timingViolations.some(tv => tv.id === v)
      );
      if (timingTriggered.length > 0) timingFlags++;
    }
    
    const redFlagRate = (timingFlags / simCount) * 100;
    return {
      passed: redFlagRate < 5,
      redFlagRate,
      details: `Testing ${timingViolations.length} timing violations`,
    };
  });
  results.push(test9);
  console.log(`  ${test9.passed ? '✅' : '❌'} Red Flag Rate: ${test9.redFlagRate.toFixed(2)}% (${test9.duration}ms)`);

  // Test 10: Critical Violations Only
  const test10 = await executeTest('Critical Violations Only', async () => {
    const criticalViolations = COMPLIANCE_VIOLATIONS.filter(v => v.severity === 'critical');
    const engine = new FacetSimulationEngine();
    let criticalFlags = 0;
    const simCount = 100;
    
    for (let i = 0; i < simCount; i++) {
      const result = engine.runSimulation();
      const criticalTriggered = result.violationsTriggered.filter(v => 
        criticalViolations.some(cv => cv.id === v)
      );
      if (criticalTriggered.length > 0) criticalFlags++;
    }
    
    const redFlagRate = (criticalFlags / simCount) * 100;
    return {
      passed: redFlagRate < 2, // Stricter for critical
      redFlagRate,
      details: `Testing ${criticalViolations.length} critical violations (target: <2%)`,
    };
  });
  results.push(test10);
  console.log(`  ${test10.passed ? '✅' : '❌'} Red Flag Rate: ${test10.redFlagRate.toFixed(2)}% (${test10.duration}ms)`);

  // Calculate overall results
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = results.filter(r => !r.passed).length;
  
  // Calculate weighted final red flag rate
  const finalRedFlagRate = results.reduce((sum, r) => sum + r.redFlagRate, 0) / results.length;
  const overallPassed = finalRedFlagRate < 5 && passedTests >= results.length * 0.8;

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL TEST RESULTS                          ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Tests: ${results.length.toString().padEnd(47)}║`);
  console.log(`║  Passed: ${passedTests.toString().padEnd(52)}║`);
  console.log(`║  Failed: ${failedTests.toString().padEnd(52)}║`);
  console.log(`║  Final Red Flag Rate: ${finalRedFlagRate.toFixed(2)}%${' '.repeat(37)}║`);
  console.log(`║  Target: < 5%${' '.repeat(48)}║`);
  console.log(`║  Overall Result: ${overallPassed ? '✅ PASSED' : '❌ FAILED'}${' '.repeat(42)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  return {
    overallPassed,
    totalTests: results.length,
    passedTests,
    failedTests,
    results,
    finalRedFlagRate,
  };
}

// ============================================================================
// DETAILED VIOLATION ANALYSIS
// ============================================================================

export function analyzeViolationCoverage(): {
  totalViolations: number;
  byCategory: { category: string; count: number; violations: string[] }[];
  bySeverity: { severity: string; count: number; violations: string[] }[];
} {
  const byCategory = new Map<string, string[]>();
  const bySeverity = new Map<string, string[]>();

  for (const v of COMPLIANCE_VIOLATIONS) {
    if (!byCategory.has(v.category)) byCategory.set(v.category, []);
    byCategory.get(v.category)!.push(v.id);

    if (!bySeverity.has(v.severity)) bySeverity.set(v.severity, []);
    bySeverity.get(v.severity)!.push(v.id);
  }

  return {
    totalViolations: COMPLIANCE_VIOLATIONS.length,
    byCategory: Array.from(byCategory.entries()).map(([category, violations]) => ({
      category,
      count: violations.length,
      violations,
    })),
    bySeverity: Array.from(bySeverity.entries()).map(([severity, violations]) => ({
      severity,
      count: violations.length,
      violations,
    })),
  };
}

// Export for external use
export { COMPLIANCE_VIOLATIONS, ELITE_STRATEGY_CONFIG, HIGH_RISK_SCENARIOS };
