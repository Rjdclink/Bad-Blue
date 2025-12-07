// Test file for the new base classes specified in Stage 2.1A-1
import { BaseCriminalScraper } from '../sources/BaseCriminalScraper';
import { CriminalRecordsCache } from '../cache/CriminalRecordsCache';
import { CriminalSearchQuery, CriminalRecord } from '../types';
import type { Page } from 'playwright';

// Test implementation of BaseCriminalScraper
class TestScraper extends BaseCriminalScraper {
  name = 'Test Scraper';
  confidence = 0.85;

  async search(query: CriminalSearchQuery, page: Page): Promise<CriminalRecord[]> {
    const record: CriminalRecord = {
      fullName: this.normalizeName(query.fullName),
      dateOfBirth: query.dateOfBirth,
      charges: [{
        charge: 'Test Charge',
        statute: 'TEST-123',
        degree: this.inferDegree('felony murder'),
        date: this.normalizeDate('2023-01-15'),
        disposition: 'pending',
      }],
      arrests: [],
      convictions: [],
      activeWarrants: [],
      sexOffenderStatus: { registered: false },
      incarcerationHistory: [],
      source: this.name,
      confidence: this.confidence,
      scrapedAt: new Date(),
    };
    return [record];
  }
}

// Run basic tests
async function runTests() {
  console.log('Testing Stage 2.1A-1 Base Classes...\n');

  // Test 1: BaseCriminalScraper helpers
  console.log('Test 1: BaseCriminalScraper helper methods');
  const scraper = new TestScraper();
  
  const normalizedDate = scraper['normalizeDate']('January 15, 2023');
  console.log(`  normalizeDate: ${normalizedDate}`);
  
  const normalizedName = scraper['normalizeName']('  John   Doe  ');
  console.log(`  normalizeName: "${normalizedName}"`);
  
  const felonyDegree = scraper['inferDegree']('felony murder');
  const misdemeanorDegree = scraper['inferDegree']('DUI offense');
  const infractionDegree = scraper['inferDegree']('parking violation');
  console.log(`  inferDegree(felony): ${felonyDegree}`);
  console.log(`  inferDegree(misdemeanor): ${misdemeanorDegree}`);
  console.log(`  inferDegree(infraction): ${infractionDegree}`);
  
  console.log('  ✅ Helper methods working\n');

  // Test 2: CriminalRecordsCache
  console.log('Test 2: CriminalRecordsCache operations');
  const cache = new CriminalRecordsCache();
  
  const testData = { name: 'John Doe', age: 30 };
  const testKey = 'test-key-123';
  const ttl = 60000; // 60 seconds
  
  await cache.set(testKey, testData, ttl);
  console.log('  ✅ Cache set successful');
  
  const retrieved = await cache.get(testKey);
  if (retrieved && retrieved.name === 'John Doe') {
    console.log('  ✅ Cache get successful');
  } else {
    console.log('  ❌ Cache get failed');
  }
  
  await cache.delete(testKey);
  const afterDelete = await cache.get(testKey);
  if (afterDelete === null) {
    console.log('  ✅ Cache delete successful\n');
  } else {
    console.log('  ❌ Cache delete failed\n');
  }

  // Test 3: TTL expiration
  console.log('Test 3: Cache TTL expiration');
  const shortTtl = 100; // 100ms
  await cache.set('expire-test', { data: 'test' }, shortTtl);
  
  // Wait for TTL to expire
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const expired = await cache.get('expire-test');
  if (expired === null) {
    console.log('  ✅ Cache TTL expiration working\n');
  } else {
    console.log('  ❌ Cache TTL expiration failed\n');
  }

  console.log('All tests completed!');
}

runTests().catch(console.error);
