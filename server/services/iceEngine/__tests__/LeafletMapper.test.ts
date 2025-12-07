import { LeafletMapper } from '../exif/LeafletMapper';
import type { LocationData } from '../exif/ExifExtractor';
import { promises as fs } from 'fs';
import path from 'path';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class LeafletMapperTestSuite {
  private results: TestResult[] = [];
  private mapper: LeafletMapper;
  private testOutputPath: string;

  constructor() {
    this.mapper = new LeafletMapper();
    this.testOutputPath = path.join(process.cwd(), 'test-output', 'maps');
  }

  async testGenerateMapHTML(): Promise<TestResult> {
    const start = Date.now();
    try {
      const locations: LocationData[] = [
        {
          latitude: 40.7128,
          longitude: -74.0060,
          altitude: 10,
          timestamp: new Date('2024-01-01'),
          device: {
            make: 'Apple',
            model: 'iPhone 12',
          },
          source: {
            filename: 'test1.jpg',
            uploadedBy: 'user1',
          },
        },
        {
          latitude: 40.7589,
          longitude: -73.9851,
          timestamp: new Date('2024-01-02'),
          source: {
            filename: 'test2.jpg',
            uploadedBy: 'user2',
          },
        },
      ];

      const htmlPath = await this.mapper.generateMapHTML({
        locations,
        caseId: 'test-case-123',
        outputPath: this.testOutputPath,
      });

      // Check if file was created
      const fileExists = await fs.access(htmlPath).then(() => true).catch(() => false);
      const content = fileExists ? await fs.readFile(htmlPath, 'utf-8') : '';
      
      const passed = fileExists && 
        content.includes('Evidence Map - Case test-case-123') &&
        content.includes('leaflet');

      // Cleanup
      if (fileExists) {
        await fs.unlink(htmlPath).catch(() => {});
      }

      return {
        testName: 'should generate map HTML with locations',
        passed,
        details: passed
          ? `HTML file created at ${htmlPath}`
          : 'Failed to generate valid HTML file',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should generate map HTML with locations',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testEmptyLocationsError(): Promise<TestResult> {
    const start = Date.now();
    try {
      let errorThrown = false;
      try {
        await this.mapper.generateMapHTML({
          locations: [],
          caseId: 'test-case-empty',
          outputPath: this.testOutputPath,
        });
      } catch (error) {
        errorThrown = error instanceof Error && 
          error.message.includes('No locations to map');
      }

      return {
        testName: 'should throw error for empty locations',
        passed: errorThrown,
        details: errorThrown
          ? 'Correctly threw error for empty locations'
          : 'Did not throw expected error',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should throw error for empty locations',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testMarkerGeneration(): Promise<TestResult> {
    const start = Date.now();
    try {
      const locations: LocationData[] = [
        {
          latitude: 34.0522,
          longitude: -118.2437,
          altitude: 100,
          direction: 180,
          timestamp: new Date('2024-01-01'),
          device: {
            make: 'Samsung',
            model: 'Galaxy S21',
          },
          source: {
            filename: 'test.jpg',
            uploadedBy: 'user1',
            consentGiven: true,
          },
        },
      ];

      const htmlPath = await this.mapper.generateMapHTML({
        locations,
        caseId: 'test-markers',
        outputPath: this.testOutputPath,
      });

      const content = await fs.readFile(htmlPath, 'utf-8');
      
      const passed = content.includes('marker0') &&
        content.includes('Evidence 1') &&
        content.includes('Samsung') &&
        content.includes('Galaxy S21') &&
        content.includes('🏔️ 100m') &&
        content.includes('🧭 180°');

      // Cleanup
      await fs.unlink(htmlPath).catch(() => {});

      return {
        testName: 'should generate markers with all metadata',
        passed,
        details: passed
          ? 'Markers contain device info, altitude, and direction'
          : 'Markers missing expected metadata',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should generate markers with all metadata',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async cleanup(): Promise<void> {
    try {
      // Clean up test output directory
      await fs.rm(this.testOutputPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];

    this.results.push(await this.testGenerateMapHTML());
    this.results.push(await this.testEmptyLocationsError());
    this.results.push(await this.testMarkerGeneration());

    await this.cleanup();

    return this.results;
  }

  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('LEAFLET MAPPER TEST SUITE RESULTS');
    console.log('='.repeat(80));

    let passed = 0;
    let failed = 0;

    this.results.forEach((result) => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`\n${status} - ${result.testName}`);
      console.log(`  Duration: ${result.duration}ms`);
      console.log(`  Details: ${result.details}`);

      if (result.passed) passed++;
      else failed++;
    });

    console.log('\n' + '='.repeat(80));
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(80) + '\n');
  }
}

// Export function to run tests
export async function runLeafletMapperTests(): Promise<boolean> {
  const suite = new LeafletMapperTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every((r) => r.passed);
}
