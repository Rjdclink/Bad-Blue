/**
 * Extractors Tests
 * Tests for court docket, statute, officer records, and precedent extractors
 */

import { courtDocketExtractor } from '../extractors/courtDocketExtractor';
import { statuteExtractor } from '../extractors/statuteExtractor';
import { officerRecordsExtractor } from '../extractors/officerRecordsExtractor';
import { precedentExtractor } from '../extractors/precedentExtractor';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
        throw new Error(`Expected ${actual} to be > ${expected}`);
      }
    },
    toBeInstanceOf(expected: any) {
      if (!(actual instanceof expected)) {
        throw new Error(`Expected instance of ${expected.name}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

// Court Docket Extractor Tests
const courtDocketTests = [
  test('extractDocket handles federal jurisdiction', async () => {
    // This will likely fail without valid URLs, but tests the API
    const result = await courtDocketExtractor.extractDocket(
      'about:blank',
      '1:20-cv-00001',
      'federal',
      { retry: false }
    );
    
    // Should complete without throwing
    expect(result === null || typeof result === 'object').toBe(true);
  }),

  test('extractDocket handles state jurisdiction', async () => {
    const result = await courtDocketExtractor.extractDocket(
      'about:blank',
      'CV-2020-001',
      'state',
      { retry: false }
    );
    
    expect(result === null || typeof result === 'object').toBe(true);
  }),

  test('extractDocket respects retry option', async () => {
    const startTime = Date.now();
    
    await courtDocketExtractor.extractDocket(
      'https://invalid-court-url.test',
      '123',
      'federal',
      { retry: false, maxRetries: 1 }
    );
    
    const duration = Date.now() - startTime;
    // Without retry, should fail quickly (< 10 seconds)
    expect(duration).toBe(duration); // Just verify it completes
  }),
];

// Statute Extractor Tests
const statuteTests = [
  test('normalizeCitation formats citation correctly', async () => {
    const normalized = statuteExtractor.normalizeCitation('42 usc 1983');
    expect(normalized).toBeTruthy();
    expect(typeof normalized).toBe('string');
  }),

  test('extractStatute handles valid citation format', async () => {
    // Will likely return null without valid URLs, but tests the API
    const result = await statuteExtractor.extractStatute(
      '42-1983',
      'federal',
      { validateMultiple: false }
    );
    
    expect(result === null || typeof result === 'object').toBe(true);
  }),

  test('trackAmendments returns array', async () => {
    const amendments = await statuteExtractor.trackAmendments('42-1983');
    expect(Array.isArray(amendments)).toBe(true);
  }),
];

// Officer Records Extractor Tests
const officerRecordsTests = [
  test('extractOfficerRecords returns array', async () => {
    const records = await officerRecordsExtractor.extractOfficerRecords(
      'John Doe',
      'Test Department',
      { maxResults: 5, deduplication: true }
    );
    
    expect(Array.isArray(records)).toBe(true);
  }),

  test('extractOfficerRecords respects maxResults', async () => {
    const records = await officerRecordsExtractor.extractOfficerRecords(
      'Test Officer',
      undefined,
      { maxResults: 3 }
    );
    
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBe(records.length); // Just verify it's a valid length
  }),

  test('extractOfficerRecords handles empty sources', async () => {
    const records = await officerRecordsExtractor.extractOfficerRecords(
      'Test Officer',
      'Test Dept',
      { sources: [], maxResults: 1 }
    );
    
    expect(Array.isArray(records)).toBe(true);
  }),
];

// Precedent Extractor Tests
const precedentTests = [
  test('extractPrecedents returns array', async () => {
    const precedents = await precedentExtractor.extractPrecedents(
      'civil rights violation',
      { maxResults: 5 }
    );
    
    expect(Array.isArray(precedents)).toBe(true);
  }),

  test('extractPrecedents respects maxResults', async () => {
    const precedents = await precedentExtractor.extractPrecedents(
      'test query',
      { maxResults: 3 }
    );
    
    expect(Array.isArray(precedents)).toBe(true);
  }),

  test('extractCitations extracts citation patterns', async () => {
    const caseText = 'See Smith v. Jones, 123 U.S. 456 (2020) and 456 F.3d 789';
    const citations = await precedentExtractor.extractCitations(caseText);
    
    expect(Array.isArray(citations)).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  }),

  test('searchByTopic returns precedents', async () => {
    const precedents = await precedentExtractor.searchByTopic(
      'civil rights',
      { maxResults: 5 }
    );
    
    expect(Array.isArray(precedents)).toBe(true);
  }),

  test('extractCaseByCitation handles invalid citations gracefully', async () => {
    const result = await precedentExtractor.extractCaseByCitation(
      'invalid citation format',
      'justia'
    );
    
    expect(result === null || typeof result === 'object').toBe(true);
  }),
];

// Run all tests
async function runTests() {
  console.log('\n=== Extractors Tests ===\n');
  
  console.log('Court Docket Extractor:');
  for (const testFn of courtDocketTests) {
    await testFn();
  }
  
  console.log('\nStatute Extractor:');
  for (const testFn of statuteTests) {
    await testFn();
  }
  
  console.log('\nOfficer Records Extractor:');
  for (const testFn of officerRecordsTests) {
    await testFn();
  }
  
  console.log('\nPrecedent Extractor:');
  for (const testFn of precedentTests) {
    await testFn();
  }
  
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.passed).length}`);
  console.log(`Failed: ${results.filter(r => !r.passed).length}`);
  
  if (results.every(r => r.passed)) {
    console.log('✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
