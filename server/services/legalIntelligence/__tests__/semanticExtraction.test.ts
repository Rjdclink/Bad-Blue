/**
 * Semantic Extraction Tests
 * Tests for schema validation, content filtering, and extraction
 * Run with: tsx server/services/legalIntelligence/__tests__/semanticExtraction.test.ts
 */

import { 
  validateExtraction,
  getSchemaByName,
  getAllSchemas,
  STATUTE,
  OFFICER_RECORD,
  COURT_DOCKET,
  CASE_OPINION
} from '../schemas';
import { ContentFilter } from '../contentFilter';
import { MarkdownConverter } from '../markdownConverter';
import { ExtractionCache } from '../extractionCache';

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
    toContain(expected: any) {
      if (!Array.isArray(actual)) {
        throw new Error('toContain requires an array');
      }
      if (!actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

// Schema validation tests
const schemaTests = [
  test('getAllSchemas returns all schemas', async () => {
    const schemas = getAllSchemas();
    expect(schemas.length).toBe(4);
    expect(schemas.map(s => s.name)).toContain('statute');
    expect(schemas.map(s => s.name)).toContain('officer_record');
    expect(schemas.map(s => s.name)).toContain('court_docket');
    expect(schemas.map(s => s.name)).toContain('case_opinion');
  }),

  test('getSchemaByName returns correct schema', async () => {
    const schema = getSchemaByName('statute');
    expect(schema).toBeTruthy();
    expect(schema?.name).toBe('statute');
    // Verify description contains 'statute' (case-insensitive)
    expect(schema?.description.toLowerCase().includes('statute')).toBe(true);
  }),

  test('getSchemaByName returns undefined for unknown schema', async () => {
    const schema = getSchemaByName('unknown_schema');
    expect(schema).toBeFalsy();
  }),

  test('validateExtraction accepts valid statute data', async () => {
    const data = {
      citation: '42 U.S.C. § 1983',
      title: 'Civil action for deprivation of rights',
      jurisdiction: 'Federal',
      text: 'Every person who, under color of any statute...',
    };
    const result = validateExtraction('statute', data);
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();
  }),

  test('validateExtraction rejects invalid statute data', async () => {
    const data = {
      citation: '42 U.S.C. § 1983',
      // Missing required fields: title, jurisdiction, text
    };
    const result = validateExtraction('statute', data);
    expect(result.success).toBe(false);
    expect(result.errors).toBeTruthy();
  }),

  test('validateExtraction accepts valid officer record data', async () => {
    const data = {
      name: 'John Smith',
      department: 'NYPD',
    };
    const result = validateExtraction('officer_record', data);
    expect(result.success).toBe(true);
  }),

  test('validateExtraction accepts valid court docket data', async () => {
    const data = {
      caseNumber: '21-CV-1234',
      caseName: 'Smith v. Jones',
      court: 'District Court for the Southern District of New York',
      parties: {
        plaintiffs: ['John Smith'],
        defendants: ['Jane Jones'],
      },
      status: 'Active',
    };
    const result = validateExtraction('court_docket', data);
    expect(result.success).toBe(true);
  }),
];

// Content filtering tests
const contentFilterTests = [
  test('ContentFilter removes script tags', async () => {
    const filter = new ContentFilter();
    const html = '<div><p>Content with legal terms like plaintiff and court proceedings</p></div><script>alert("bad")</script>';
    const filtered = await filter.filterContent(html);
    // Check for '<script' to ensure the HTML tag itself is removed, not just the word 'script'
    expect(filtered.includes('<script')).toBe(false);
    expect(filtered.includes('Content')).toBe(true);
  }),

  test('ContentFilter removes navigation elements', async () => {
    const filter = new ContentFilter();
    const html = '<nav>Menu</nav><main><p>Main content about the court case and the plaintiff allegations</p></main>';
    const filtered = await filter.filterContent(html);
    expect(filtered.includes('Menu')).toBe(false);
    expect(filtered.includes('Main content')).toBe(true);
  }),

  test('ContentFilter prioritizes legal terms', async () => {
    const filter = new ContentFilter();
    const html = `
      <div>Random content without legal terms</div>
      <div>The plaintiff filed a complaint in the District Court regarding the statute violation.</div>
    `;
    const filtered = await filter.filterContent(html);
    expect(filtered.includes('plaintiff')).toBe(true);
    expect(filtered.includes('statute')).toBe(true);
  }),
];

// Markdown converter tests
const markdownTests = [
  test('MarkdownConverter converts headings', async () => {
    const converter = new MarkdownConverter();
    const html = '<h1>Title</h1><h2>Subtitle</h2>';
    const markdown = converter.convert(html);
    expect(markdown.includes('# Title')).toBe(true);
    expect(markdown.includes('## Subtitle')).toBe(true);
  }),

  test('MarkdownConverter converts paragraphs', async () => {
    const converter = new MarkdownConverter();
    const html = '<p>First paragraph</p><p>Second paragraph</p>';
    const markdown = converter.convert(html);
    expect(markdown.includes('First paragraph')).toBe(true);
    expect(markdown.includes('Second paragraph')).toBe(true);
  }),

  test('MarkdownConverter formats case citations', async () => {
    const converter = new MarkdownConverter();
    const html = '<p>In Smith v. Jones, the court ruled...</p>';
    const markdown = converter.convert(html);
    expect(markdown.includes('**Smith v. Jones**')).toBe(true);
  }),

  test('MarkdownConverter formats statutes', async () => {
    const converter = new MarkdownConverter();
    const html = '<p>Pursuant to 42 U.S.C. § 1983...</p>';
    const markdown = converter.convert(html);
    expect(markdown.includes('`42 U.S.C. § 1983`')).toBe(true);
  }),

  test('MarkdownConverter preserves tables', async () => {
    const converter = new MarkdownConverter();
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>Item 1</td><td>100</td></tr></tbody>
      </table>
    `;
    const markdown = converter.convert(html);
    expect(markdown.includes('| Name | Value |')).toBe(true);
    expect(markdown.includes('| Item 1 | 100 |')).toBe(true);
  }),

  test('MarkdownConverter converts lists', async () => {
    const converter = new MarkdownConverter();
    const html = '<ul><li>First item</li><li>Second item</li></ul>';
    const markdown = converter.convert(html);
    expect(markdown.includes('- First item')).toBe(true);
    expect(markdown.includes('- Second item')).toBe(true);
  }),
];

// Cache tests
const cacheTests = [
  test('ExtractionCache stores and retrieves data', async () => {
    const cache = new ExtractionCache({ defaultTTL: 1000 });
    const data = { test: 'value' };
    cache.set('statute', 'http://example.com', data);
    const retrieved = cache.get('statute', 'http://example.com');
    expect(retrieved).toEqual(data);
    cache.destroy();
  }),

  test('ExtractionCache returns null for expired entries', async () => {
    const cache = new ExtractionCache({ defaultTTL: 100 }); // 100ms TTL
    cache.set('statute', 'http://example.com', { test: 'value' });
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const retrieved = cache.get('statute', 'http://example.com');
    expect(retrieved).toBe(null);
    cache.destroy();
  }),

  test('ExtractionCache.has returns true for valid entries', async () => {
    const cache = new ExtractionCache({ defaultTTL: 1000 });
    cache.set('statute', 'http://example.com', { test: 'value' });
    expect(cache.has('statute', 'http://example.com')).toBe(true);
    cache.destroy();
  }),

  test('ExtractionCache.delete removes entries', async () => {
    const cache = new ExtractionCache({ defaultTTL: 1000 });
    cache.set('statute', 'http://example.com', { test: 'value' });
    cache.delete('statute', 'http://example.com');
    expect(cache.has('statute', 'http://example.com')).toBe(false);
    cache.destroy();
  }),

  test('ExtractionCache.clear removes all entries', async () => {
    const cache = new ExtractionCache({ defaultTTL: 1000 });
    cache.set('statute', 'http://example1.com', { test: 'value1' });
    cache.set('officer_record', 'http://example2.com', { test: 'value2' });
    cache.clear();
    expect(cache.has('statute', 'http://example1.com')).toBe(false);
    expect(cache.has('officer_record', 'http://example2.com')).toBe(false);
    cache.destroy();
  }),

  test('ExtractionCache.clearSchema removes only schema entries', async () => {
    const cache = new ExtractionCache({ defaultTTL: 1000 });
    cache.set('statute', 'http://example1.com', { test: 'value1' });
    cache.set('officer_record', 'http://example2.com', { test: 'value2' });
    cache.clearSchema('statute');
    expect(cache.has('statute', 'http://example1.com')).toBe(false);
    expect(cache.has('officer_record', 'http://example2.com')).toBe(true);
    cache.destroy();
  }),
];

// Run all tests
async function runAllTests() {
  console.log('\n=== Semantic Extraction Tests ===\n');
  
  console.log('Running schema tests...');
  for (const test of schemaTests) {
    await test();
  }
  
  console.log('\nRunning content filter tests...');
  for (const test of contentFilterTests) {
    await test();
  }
  
  console.log('\nRunning markdown converter tests...');
  for (const test of markdownTests) {
    await test();
  }
  
  console.log('\nRunning cache tests...');
  for (const test of cacheTests) {
    await test();
  }
  
  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
