/**
 * ML/NLP Integration Tests
 * 
 * Simple validation tests for the ML/NLP Intelligence Layer
 * Run with: tsx server/services/mlnlp/__tests__/integration.test.ts
 */

import { mlnlpIntelligenceService } from '../intelligenceService';
import { nlpTextWorker } from '../nlpTextWorker';
import { mlEntityResolutionWorker } from '../mlEntityResolutionWorker';
import { mlConfidenceScoringWorker } from '../mlConfidenceScoringWorker';

async function runTests() {
  console.log('🧪 Starting ML/NLP Integration Tests...\n');
  
  let passed = 0;
  let failed = 0;

  // Test 1: NLP Text Processing
  console.log('Test 1: NLP Text Processing');
  try {
    const text = 'Officer John Doe, badge #12345, works at NYPD in New York. Contact: john.doe@nypd.gov or (555) 123-4567';
    const result = await nlpTextWorker.process({ text });
    
    if (result.success && result.data.entities.length > 0) {
      console.log('✅ PASSED - Extracted', result.data.entities.length, 'entities');
      console.log('   Entities found:', result.data.entities.map((e: any) => `${e.type}:${e.value}`).join(', '));
      passed++;
    } else {
      console.log('❌ FAILED - No entities extracted');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Test 2: Entity Resolution
  console.log('Test 2: Entity Resolution');
  try {
    const records = [
      { name: 'John Doe', email: 'john@example.com', source: 'linkedin' },
      { name: 'J. Doe', email: 'john@example.com', source: 'twitter' },
      { name: 'John Doe', phone: '5551234567', source: 'whitepages' },
    ];
    
    const result = await mlEntityResolutionWorker.process({ entities: records });
    
    if (result.success && result.data.resolvedEntities.length > 0) {
      console.log('✅ PASSED - Resolved', result.data.totalRecords, 'records into', result.data.uniqueEntities, 'entities');
      console.log('   Primary entity:', result.data.resolvedEntities[0].primaryName);
      passed++;
    } else {
      console.log('❌ FAILED - Entity resolution failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Test 3: Confidence Scoring
  console.log('Test 3: Confidence Scoring');
  try {
    const entities = [
      {
        id: 'test1',
        name: 'John Doe',
        attributes: [
          { name: 'email', value: 'john@example.com', source: 'public_records' },
          { name: 'phone', value: '555-1234', source: 'whitepages' }
        ],
        sources: ['linkedin', 'twitter', 'whitepages']
      }
    ];
    
    const result = await mlConfidenceScoringWorker.process({ entities });
    
    if (result.success && result.data.length > 0) {
      const score = result.data[0];
      console.log('✅ PASSED - Confidence score:', score.overallConfidence);
      console.log('   Quality metrics:', JSON.stringify(score.qualityMetrics));
      passed++;
    } else {
      console.log('❌ FAILED - Confidence scoring failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Test 4: Full Pipeline
  console.log('Test 4: Full ML/NLP Pipeline');
  try {
    await mlnlpIntelligenceService.initialize();
    
    const text = 'Officer Jane Smith works at Los Angeles Police Department. Email: jane.smith@lapd.gov';
    const result = await mlnlpIntelligenceService.processFullPipeline(text, [], {
      enableNLP: true,
      enableEntityResolution: true,
      enableConfidenceScoring: true,
    });
    
    if (result.success) {
      console.log('✅ PASSED - Full pipeline completed');
      console.log('   Workers executed:', result.workersExecuted.join(', '));
      console.log('   Processing time:', result.processingTime, 'ms');
      passed++;
    } else {
      console.log('❌ FAILED - Pipeline failed:', result.errors?.join(', '));
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Test 5: Health Checks
  console.log('Test 5: Health Checks');
  try {
    const health = await mlnlpIntelligenceService.getHealthStatus();
    
    if (health.healthy) {
      console.log('✅ PASSED - All workers healthy');
      console.log('   Workers:', Object.keys(health.workers).join(', '));
      passed++;
    } else {
      console.log('❌ FAILED - Some workers unhealthy:', health.workers);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Test 6: OSINT Data Processing
  console.log('Test 6: OSINT Data Processing');
  try {
    const osintData = {
      text: 'Detective Mark Johnson of the Chicago Police Department has been with the force for 15 years.',
      entities: [
        { name: 'Mark Johnson', badge: '98765', source: 'roster' }
      ],
      sources: [
        { name: 'police_roster', data: { department: 'CPD' } }
      ]
    };
    
    const result = await mlnlpIntelligenceService.processOSINTData(osintData);
    
    if (result.success) {
      console.log('✅ PASSED - OSINT data processed successfully');
      if (result.nlpResults) {
        console.log('   NLP entities found:', result.nlpResults.entities.length);
      }
      if (result.resolvedEntities) {
        console.log('   Resolved entities:', result.resolvedEntities.length);
      }
      passed++;
    } else {
      console.log('❌ FAILED - OSINT processing failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAILED -', error);
    failed++;
  }
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('Test Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('═══════════════════════════════════════');

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
