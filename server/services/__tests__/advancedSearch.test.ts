/**
 * Advanced Search Service Tests
 * Run with: tsx server/services/__tests__/advancedSearch.test.ts
 */

import { advancedSearch } from '../advancedSearch';
import { queryBuilder } from '../searchQueryBuilder';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>) {
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
    toContain(expected: string) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`);
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`Expected string to contain "${expected}", got "${actual}"`);
        }
      } else {
        throw new Error('toContain requires an array or string');
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number') {
        throw new Error('toBeGreaterThan requires a number');
      }
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
  };
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Advanced Search Service Tests');
  console.log('═══════════════════════════════════════════════════════\n');

  const tests = [
    test('should generate government record dorks', () => {
      const dorks = advancedSearch.generatePersonDorks('John Smith');
      
      expect(dorks).toContain('"John Smith" site:*.gov filetype:pdf');
      expect(dorks.length).toBeGreaterThan(10);
    }),

    test('should include department-specific dorks', () => {
      const dorks = advancedSearch.generatePersonDorks('John Smith', {
        department: 'NYPD'
      });
      
      const hasDept = dorks.some(d => d.includes('NYPD'));
      expect(hasDept).toBe(true);
    }),

    test('should include badge-specific dorks', () => {
      const dorks = advancedSearch.generatePersonDorks('John Smith', {
        badge: '12345'
      });
      
      const hasBadge = dorks.some(d => d.includes('badge 12345'));
      expect(hasBadge).toBe(true);
    }),

    test('should include location-specific dorks', () => {
      const dorks = advancedSearch.generatePersonDorks('John Smith', {
        location: 'New York'
      });
      
      const hasLocation = dorks.some(d => d.includes('New York'));
      expect(hasLocation).toBe(true);
    }),

    test('should generate department dorks', () => {
      const dorks = advancedSearch.generateDepartmentDorks('NYPD');
      
      expect(dorks.length).toBeGreaterThan(3);
      const hasRoster = dorks.some(d => d.includes('roster'));
      expect(hasRoster).toBe(true);
    }),

    test('should build query with site operator', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['test'],
        site: '*.gov',
      });

      expect(query).toContain('site:*.gov');
    }),

    test('should build query with filetype operator', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['test'],
        filetype: 'pdf',
      });

      expect(query).toContain('filetype:pdf');
    }),

    test('should build query with exclusions', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['test'],
        exclude: ['facebook', 'twitter'],
      });

      expect(query).toContain('-facebook');
      expect(query).toContain('-twitter');
    }),

    test('should quote multi-word keywords', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['John Smith'],
      });

      expect(query).toContain('"John Smith"');
    }),

    test('should build complex query with multiple operators', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['John Smith'],
        site: '*.gov',
        filetype: 'pdf',
        inurl: 'roster',
        exclude: ['facebook'],
      });

      expect(query).toContain('"John Smith"');
      expect(query).toContain('site:*.gov');
      expect(query).toContain('filetype:pdf');
      expect(query).toContain('inurl:roster');
      expect(query).toContain('-facebook');
    }),

    test('query builder should build complex query', () => {
      const query = queryBuilder
        .keyword('John Smith')
        .site('*.gov')
        .fileType('pdf')
        .inUrl('roster')
        .exclude('facebook')
        .build();

      expect(query).toContain('site:*.gov');
      expect(query).toContain('filetype:pdf');
      expect(query).toContain('-facebook');
    }),

    test('query builder should support method chaining', () => {
      const query = queryBuilder
        .reset()
        .keyword('test')
        .site('example.com')
        .fileType('pdf')
        .build();

      expect(query).toContain('test');
      expect(query).toContain('site:example.com');
      expect(query).toContain('filetype:pdf');
    }),

    test('should return search patterns', () => {
      const patterns = advancedSearch.getSearchPatterns();
      
      if (!patterns.govRecords || typeof patterns.govRecords !== 'string') {
        throw new Error('Expected govRecords to be a string');
      }
      if (!patterns.courtDocs || typeof patterns.courtDocs !== 'string') {
        throw new Error('Expected courtDocs to be a string');
      }
      if (!patterns.payroll || typeof patterns.payroll !== 'string') {
        throw new Error('Expected payroll to be a string');
      }
    }),

    test('should handle date range operators', () => {
      const query = advancedSearch.buildQuery({
        keywords: ['test'],
        dateAfter: '2024-01-01',
        dateBefore: '2024-12-31',
      });

      expect(query).toContain('after:2024-01-01');
      expect(query).toContain('before:2024-12-31');
    }),
  ];

  for (const testFn of tests) {
    await testFn();
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test Summary');
  console.log('═══════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
