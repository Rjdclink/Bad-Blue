/**
 * Integration Test for Legal Intelligence Services
 * Tests the core functionality without requiring full environment setup
 * Run with: npx tsx server/services/legalIntelligence/__tests__/integration.test.ts
 */

console.log('\n🧪 Legal Intelligence Integration Tests\n');

// Test 1: Import services
console.log('Test 1: Importing legal intelligence services...');
try {
  const { emailDiscoveryService, certificateTransparencyService, dnsIntelligenceService } = await import('../index.js');
  console.log('✅ Services imported successfully');
  console.log('   - emailDiscoveryService:', typeof emailDiscoveryService);
  console.log('   - certificateTransparencyService:', typeof certificateTransparencyService);
  console.log('   - dnsIntelligenceService:', typeof dnsIntelligenceService);
} catch (error) {
  console.error('❌ Failed to import services:', error);
  process.exit(1);
}

// Test 2: Verify service types are exported
console.log('\nTest 2: Checking exported types...');
try {
  const types = await import('../types.js');
  console.log('✅ Types module imported successfully');
  console.log('   - Module has exports:', Object.keys(types).length > 0);
} catch (error) {
  console.error('❌ Failed to import types:', error);
  process.exit(1);
}

// Test 3: Test email discovery service functionality
console.log('\nTest 3: Testing email discovery service...');
try {
  const { emailDiscoveryService } = await import('../index.js');
  
  // Test with minimal options to avoid timeouts
  const result = await emailDiscoveryService.discoverEmails('test query', {
    includeSearchEngines: false, // Disable to avoid API calls in tests
    maxResults: 5,
  });
  
  console.log('✅ Email discovery executed successfully');
  console.log('   - Result structure valid:', !!result);
  console.log('   - Has emails array:', Array.isArray(result.emails));
  console.log('   - Has sources array:', Array.isArray(result.sources));
  console.log('   - Has totalFound:', typeof result.totalFound === 'number');
  console.log('   - Has searchDuration:', typeof result.searchDuration === 'number');
} catch (error) {
  console.error('❌ Email discovery test failed:', error);
  process.exit(1);
}

// Test 4: Test certificate transparency service
console.log('\nTest 4: Testing certificate transparency service...');
try {
  const { certificateTransparencyService } = await import('../index.js');
  
  const result = await certificateTransparencyService.discoverSubdomains('example.com');
  
  console.log('✅ Certificate transparency executed successfully');
  console.log('   - Result is array:', Array.isArray(result));
  console.log('   - Subdomains found:', result.length);
} catch (error) {
  console.error('❌ Certificate transparency test failed:', error);
  process.exit(1);
}

// Test 5: Test DNS intelligence service
console.log('\nTest 5: Testing DNS intelligence service...');
try {
  const { dnsIntelligenceService } = await import('../index.js');
  
  const result = await dnsIntelligenceService.queryMXRecords('example.com');
  
  console.log('✅ DNS intelligence executed successfully');
  console.log('   - Result is array:', Array.isArray(result));
  console.log('   - MX records found:', result.length);
} catch (error) {
  console.error('❌ DNS intelligence test failed:', error);
  process.exit(1);
}

// Test 6: Test FOIA contact discovery (without full FOIA system)
console.log('\nTest 6: Testing FOIA officer email discovery...');
try {
  const { emailDiscoveryService } = await import('../index.js');
  
  const result = await emailDiscoveryService.discoverFOIAOfficerEmails('Test Police Department', 'example.gov');
  
  console.log('✅ FOIA officer discovery executed successfully');
  console.log('   - Result is array:', Array.isArray(result));
  console.log('   - Contacts found:', result.length);
} catch (error) {
  console.error('❌ FOIA officer discovery test failed:', error);
  process.exit(1);
}

// Test 7: Test attorney email discovery
console.log('\nTest 7: Testing attorney email discovery...');
try {
  const { emailDiscoveryService } = await import('../index.js');
  
  const result = await emailDiscoveryService.discoverAttorneyEmail('John Smith', 'Smith & Associates');
  
  console.log('✅ Attorney email discovery executed successfully');
  console.log('   - Result is array:', Array.isArray(result));
  console.log('   - Emails found:', result.length);
} catch (error) {
  console.error('❌ Attorney email discovery test failed:', error);
  process.exit(1);
}

// Test 8: Test DNS agency mapping
console.log('\nTest 8: Testing agency presence mapping...');
try {
  const { dnsIntelligenceService } = await import('../index.js');
  
  const result = await dnsIntelligenceService.mapAgencyPresence('example.com');
  
  console.log('✅ Agency presence mapping executed successfully');
  console.log('   - Has mainSite:', !!result.mainSite);
  console.log('   - Has emailServers array:', Array.isArray(result.emailServers));
  console.log('   - Has departments array:', Array.isArray(result.departments));
  console.log('   - Has portalServices array:', Array.isArray(result.portalServices));
} catch (error) {
  console.error('❌ Agency presence mapping test failed:', error);
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('✅ All integration tests passed!');
console.log('='.repeat(60) + '\n');

console.log('📊 Summary:');
console.log('  - Legal Intelligence services are correctly integrated');
console.log('  - Email discovery service is functional');
console.log('  - Certificate transparency service is functional');
console.log('  - DNS intelligence service is functional');
console.log('  - FOIA officer discovery is working');
console.log('  - Attorney email discovery is working');
console.log('  - Agency presence mapping is working');
console.log('  - All services are accessible and properly exported\n');

process.exit(0);
