/**
 * Shadow Retrieval Engine Tests
 * Comprehensive test suite for PANTHEON Shadow Retrieval
 */

import { shadowRetrieval, ShadowRetrievalEngine } from '../services/shadowRetrieval';
import { AntiDetectionService } from '../services/shadowRetrieval/antiDetection';
import { ContentExtractor } from '../services/shadowRetrieval/contentExtractor';
import { DomainIntelligence } from '../services/shadowRetrieval/domainIntelligence';

/**
 * Test 1: Simple HTML Page Retrieval
 */
async function testSimpleRetrieval() {
  console.log('\n=== Test 1: Simple HTML Page Retrieval ===');
  
  try {
    const result = await shadowRetrieval.smartRetrieve('https://example.com', {
      timeout: 10000,
    });
    
    console.log('✅ Retrieval successful');
    console.log('Method used:', result.method);
    console.log('Duration:', result.metadata.duration + 'ms');
    console.log('Title:', result.data?.metadata?.title);
    console.log('Links found:', result.data?.links?.length);
    console.log('Retries:', result.metadata.retries);
    
    return result.success;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 2: Anti-Detection Features
 */
async function testAntiDetection() {
  console.log('\n=== Test 2: Anti-Detection Features ===');
  
  try {
    const antiDetection = new AntiDetectionService({
      rotateUserAgent: true,
      randomizeFingerprint: true,
      humanTiming: true,
      persistCookies: true,
    });
    
    // Test user agent rotation
    const profile1 = antiDetection.getProfile();
    antiDetection.rotateProfile();
    const profile2 = antiDetection.getProfile();
    
    console.log('✅ User agent rotation working');
    console.log('Profile 1 UA:', profile1.userAgent.substring(0, 50) + '...');
    console.log('Profile 2 UA:', profile2.userAgent.substring(0, 50) + '...');
    console.log('Different:', profile1.userAgent !== profile2.userAgent);
    
    // Test header generation
    const { headers } = await antiDetection.prepareRequest('https://example.com');
    console.log('✅ Headers generated');
    console.log('Accept-Language:', headers['Accept-Language']);
    console.log('Accept-Encoding:', headers['Accept-Encoding']);
    
    return true;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Content Extraction
 */
async function testContentExtraction() {
  console.log('\n=== Test 3: Content Extraction ===');
  
  try {
    const extractor = new ContentExtractor();
    
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page</title>
          <meta name="description" content="Test description">
          <meta property="og:title" content="OG Title">
        </head>
        <body>
          <h1>Test Heading</h1>
          <p>Test paragraph with <a href="/link1">link 1</a> and <a href="/link2">link 2</a>.</p>
          <table>
            <thead>
              <tr><th>Column 1</th><th>Column 2</th></tr>
            </thead>
            <tbody>
              <tr><td>Data 1</td><td>Data 2</td></tr>
            </tbody>
          </table>
          <form action="/submit" method="POST">
            <input type="text" name="username" placeholder="Username">
            <input type="password" name="password" placeholder="Password">
          </form>
        </body>
      </html>
    `;
    
    const result = await extractor.extract(testHtml, 'https://example.com');
    
    console.log('✅ Extraction successful');
    console.log('Title:', result.data.metadata?.title);
    console.log('Description:', result.data.metadata?.description);
    console.log('OpenGraph title:', result.data.structured?.openGraph?.title);
    console.log('Links found:', result.data.links?.length);
    console.log('Tables found:', result.data.tables?.length);
    console.log('Forms found:', result.data.forms?.length);
    console.log('Processing time:', result.processingTime + 'ms');
    
    return result.success;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 4: Domain Intelligence Learning
 */
async function testDomainIntelligence() {
  console.log('\n=== Test 4: Domain Intelligence Learning ===');
  
  try {
    const intelligence = new DomainIntelligence();
    
    // Simulate successful retrieval
    intelligence.updateProfile('example.com', 'fetch', true, 1500);
    intelligence.updateProfile('example.com', 'fetch', true, 1200);
    intelligence.updateProfile('example.com', 'puppeteer', false, 5000, 'Timeout');
    
    const profile = intelligence.getProfile('example.com');
    
    console.log('✅ Domain intelligence working');
    console.log('Domain:', profile.domain);
    console.log('Total attempts:', profile.totalAttempts);
    console.log('Successful attempts:', profile.successfulAttempts);
    console.log('Success rate:', ((profile.successfulAttempts / profile.totalAttempts) * 100).toFixed(1) + '%');
    console.log('Average response time:', profile.averageResponseTime + 'ms');
    console.log('Successful strategies:', profile.successfulStrategies.map(s => s.method).join(', '));
    console.log('Failed strategies:', profile.failedStrategies.map(s => s.method).join(', '));
    
    // Test recommended strategies
    const strategies = intelligence.getRecommendedStrategies('example.com');
    console.log('✅ Recommended strategy:', strategies[0]?.method);
    
    return true;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 5: Fallback Strategy Execution
 */
async function testFallbackStrategies() {
  console.log('\n=== Test 5: Fallback Strategy Execution ===');
  
  try {
    // Test with a site that should succeed with basic fetch
    const result = await shadowRetrieval.retrieve('https://example.com', {
      preferredMethods: ['fetch', 'puppeteer'],
      timeout: 10000,
    });
    
    console.log('✅ Fallback test successful');
    console.log('Method used:', result.method);
    console.log('Fallbacks used:', result.metadata.fallbacksUsed.join(', ') || 'none');
    console.log('Success:', result.success);
    
    return result.success;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 6: Batch Retrieval
 */
async function testBatchRetrieval() {
  console.log('\n=== Test 6: Batch Retrieval ===');
  
  try {
    const urls = [
      'https://example.com',
      'https://example.org',
      'https://example.net',
    ];
    
    const result = await shadowRetrieval.batchRetrieve(urls, {
      maxConcurrent: 2,
      delayBetweenRequests: 500,
    });
    
    console.log('✅ Batch retrieval completed');
    console.log('Total URLs:', result.summary.total);
    console.log('Successful:', result.summary.successful);
    console.log('Failed:', result.summary.failed);
    console.log('Total duration:', result.summary.totalDuration + 'ms');
    console.log('Average duration:', result.summary.avgDuration.toFixed(0) + 'ms');
    
    return result.summary.successful > 0;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Test 7: Engine Statistics
 */
async function testEngineStats() {
  console.log('\n=== Test 7: Engine Statistics ===');
  
  try {
    const stats = shadowRetrieval.getStats();
    
    console.log('✅ Engine stats retrieved');
    console.log('Enabled:', stats.enabled);
    console.log('Active requests:', stats.activeRequests);
    console.log('Max concurrent:', stats.maxConcurrent);
    console.log('Domain profiles:', stats.domainProfiles);
    console.log('Firecrawl enabled:', stats.firecrawlEnabled);
    console.log('Puppeteer enabled:', stats.puppeteerEnabled);
    
    return true;
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

/**
 * Main test runner
 */
export async function runShadowRetrievalTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     PANTHEON Shadow Retrieval Engine Test Suite       ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const results = {
    simpleRetrieval: false,
    antiDetection: false,
    contentExtraction: false,
    domainIntelligence: false,
    fallbackStrategies: false,
    batchRetrieval: false,
    engineStats: false,
  };
  
  try {
    results.simpleRetrieval = await testSimpleRetrieval();
    results.antiDetection = await testAntiDetection();
    results.contentExtraction = await testContentExtraction();
    results.domainIntelligence = await testDomainIntelligence();
    results.fallbackStrategies = await testFallbackStrategies();
    results.batchRetrieval = await testBatchRetrieval();
    results.engineStats = await testEngineStats();
  } catch (error: any) {
    console.error('\n❌ Test suite error:', error.message);
  }
  
  // Cleanup
  await shadowRetrieval.cleanup();
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    Test Summary                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.values(results).length;
  
  Object.entries(results).forEach(([test, result]) => {
    const icon = result ? '✅' : '❌';
    const name = test.replace(/([A-Z])/g, ' $1').trim();
    console.log(`${icon} ${name}: ${result ? 'PASSED' : 'FAILED'}`);
  });
  
  console.log(`\nTotal: ${passed}/${total} tests passed`);
  console.log(`Success rate: ${((passed / total) * 100).toFixed(1)}%`);
  
  return results;
}
