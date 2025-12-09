// Validation script for Ultimate Hyper-Evolving Swarm Strategy
// Verifies that all components are properly integrated

export {}; // Make this a module

console.log('🔍 Validating Ultimate Hyper-Evolving Swarm Strategy...\n');

let errors = 0;
let warnings = 0;

// Test 1: Import Eden components
try {
  console.log('✓ Test 1: Importing Eden components...');
  const { eden, EDEN_CONFIG, ETHICAL_GUARDS } = await import('./eden/index.js');
  console.log('  ✅ Eden imports successful');
  console.log(`  📊 Config: ${EDEN_CONFIG.TOTAL_CAIN_CRAWLERS} Cain crawlers configured`);
  console.log(`  🛡️ Ethical Guards: ${ETHICAL_GUARDS.length} guards active`);
} catch (error: unknown) {
  console.error('  ❌ Eden import failed:', (error as Error).message);
  errors++;
}

// Test 2: Import Agent components
try {
  console.log('\n✓ Test 2: Importing Agent components...');
  const { CainCrawler, EnhancedMicroCrawler, swarmOrchestrator } = await import('./agents/index.js');
  console.log('  ✅ Agent imports successful');
  console.log('  📦 Components: CainCrawler, EnhancedMicroCrawler, SwarmOrchestrator');
} catch (error: unknown) {
  console.error('  ❌ Agent import failed:', (error as Error).message);
  errors++;
}

// Test 3: Import Core components
try {
  console.log('\n✓ Test 3: Importing Core components...');
  const { LuxSwarm } = await import('./core/lux-swarm.js');
  console.log('  ✅ Core imports successful');
  console.log('  🌟 LuxSwarm coordination system available');
} catch (error: unknown) {
  console.error('  ❌ Core import failed:', (error as Error).message);
  errors++;
}

// Test 4: Verify configuration values
try {
  console.log('\n✓ Test 4: Verifying configuration...');
  const { EDEN_CONFIG, CONTROL_SIGNALS } = await import('./eden/config.js');
  
  // Check critical config values
  const checks = [
    { name: 'Total Cain Crawlers', value: EDEN_CONFIG.TOTAL_CAIN_CRAWLERS, expected: 10 },
    { name: 'Cataclysm Detection Cains', value: EDEN_CONFIG.CATACLYSM_DETECTION_CAINS, expected: 5 },
    { name: 'Probability Monitoring Cains', value: EDEN_CONFIG.PROBABILITY_MONITORING_CAINS, expected: 5 },
    { name: 'Min Cains for Reset', value: EDEN_CONFIG.MIN_CAINS_FOR_RESET, expected: 2 },
  ];
  
  checks.forEach(check => {
    if (check.value === check.expected) {
      console.log(`  ✅ ${check.name}: ${check.value}`);
    } else {
      console.warn(`  ⚠️ ${check.name}: ${check.value} (expected ${check.expected})`);
      warnings++;
    }
  });
  
  // Verify control signals exist
  if (typeof CONTROL_SIGNALS.PROB_SIGNAL === 'function') {
    console.log('  ✅ Control signals functional');
  } else {
    console.warn('  ⚠️ Control signals may not be functional');
    warnings++;
  }
} catch (error: unknown) {
  console.error('  ❌ Configuration verification failed:', (error as Error).message);
  errors++;
}

// Test 5: Check database schema
try {
  console.log('\n✓ Test 5: Checking database schema...');
  const schema = await import('./eden/schema.js') as Record<string, unknown>;
  
  const tables = [
    'edenLessons',
    'edenStrategyTemplates',
    'edenCainStates',
    'edenMicroCrawlerStates',
    'edenSnapshots',
    'edenCataclysms',
    'edenOpportunities',
    'edenAuditLog',
  ];
  
  let foundTables = 0;
  tables.forEach(table => {
    if (schema[table]) {
      foundTables++;
    }
  });
  
  if (foundTables === tables.length) {
    console.log(`  ✅ All ${tables.length} Eden tables defined`);
  } else {
    console.warn(`  ⚠️ Only ${foundTables}/${tables.length} tables found`);
    warnings++;
  }
} catch (error: unknown) {
  console.error('  ❌ Schema check failed:', (error as Error).message);
  errors++;
}

// Test 6: Verify types
try {
  console.log('\n✓ Test 6: Verifying type definitions...');
  const types = await import('./eden/types.js');
  console.log('  ✅ All type definitions loaded successfully');
} catch (error: unknown) {
  console.error('  ❌ Type verification failed:', (error as Error).message);
  errors++;
}

// Summary
console.log('\n' + '═'.repeat(50));
console.log('VALIDATION SUMMARY');
console.log('═'.repeat(50));
console.log(`Tests Run: 6`);
console.log(`Errors: ${errors}`);
console.log(`Warnings: ${warnings}`);

if (errors === 0 && warnings === 0) {
  console.log('\n✅ ALL TESTS PASSED - System ready for initialization!');
  console.log('\n🚀 Next steps:');
  console.log('   1. Run database migration: db/migrations/eden_swarm_migration.sql');
  console.log('   2. Configure Supabase credentials in .env');
  console.log('   3. Run demo: npm run demo-swarm');
  process.exit(0);
} else if (errors === 0) {
  console.log(`\n⚠️ TESTS PASSED WITH ${warnings} WARNING(S)`);
  console.log('   System should work but review warnings above.');
  process.exit(0);
} else {
  console.log(`\n❌ VALIDATION FAILED - ${errors} error(s), ${warnings} warning(s)`);
  console.log('   Fix errors before proceeding.');
  process.exit(1);
}
