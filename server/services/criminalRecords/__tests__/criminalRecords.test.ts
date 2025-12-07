// Criminal Records Service Tests
import { CriminalRecordsFusion } from '../fusion/CriminalRecordsFusion';
import { CriminalRecordsCache } from '../cache/CriminalRecordsCache';
import type { CriminalRecord } from '../types';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class CriminalRecordsTestSuite {
  private results: TestResult[] = [];
  private cache: CriminalRecordsCache;

  constructor() {
    this.cache = new CriminalRecordsCache('.cache/test-criminal-records');
  }

  async testRecordFusion(): Promise<TestResult> {
    const start = Date.now();
    try {
      const record1: Partial<CriminalRecord> = {
        fullName: 'John Smith',
        charges: [{
          charge: 'DUI',
          statute: 'VC 23152',
          degree: 'misdemeanor',
          date: '2020-01-01'
        }],
        arrests: [],
        convictions: [],
        activeWarrants: [],
        sexOffenderStatus: { registered: false },
        incarcerationHistory: [],
        source: 'State Court',
        confidence: 0.85,
        scrapedAt: new Date()
      };

      const record2: Partial<CriminalRecord> = {
        fullName: 'John Smith',
        charges: [{
          charge: 'DUI',
          statute: 'VC 23152',
          degree: 'misdemeanor',
          date: '2020-01-01'
        }],
        arrests: [],
        convictions: [],
        activeWarrants: [],
        sexOffenderStatus: { registered: false },
        incarcerationHistory: [],
        source: 'County Court',
        confidence: 0.90,
        scrapedAt: new Date()
      };

      const fused = CriminalRecordsFusion.fuse([record1, record2]);
      const passed = fused.charges.length === 1; // Should deduplicate

      return {
        testName: 'should deduplicate charges in record fusion',
        passed,
        details: passed 
          ? `Fused ${fused.charges.length} unique charges from 2 records` 
          : `Expected 1 charge after deduplication, got ${fused.charges.length}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should deduplicate charges in record fusion',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testRiskScoring(): Promise<TestResult> {
    const start = Date.now();
    try {
      const record: CriminalRecord = {
        fullName: 'John Smith',
        charges: [],
        arrests: [],
        convictions: [],
        activeWarrants: [],
        sexOffenderStatus: { registered: true, tier: 3 },
        incarcerationHistory: [],
        source: 'Test',
        confidence: 1.0,
        scrapedAt: new Date()
      };

      const riskScore = CriminalRecordsFusion.calculateRiskScore(record);
      const passed = riskScore === 10; // Sex offender should always be max risk

      return {
        testName: 'should calculate maximum risk for sex offenders',
        passed,
        details: passed 
          ? `Risk score: ${riskScore}/10` 
          : `Expected risk score 10, got ${riskScore}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should calculate maximum risk for sex offenders',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testCaching(): Promise<TestResult> {
    const start = Date.now();
    try {
      const record: CriminalRecord = {
        fullName: 'Test Person',
        dateOfBirth: '1990-01-01',
        charges: [],
        arrests: [],
        convictions: [],
        activeWarrants: [],
        sexOffenderStatus: { registered: false },
        incarcerationHistory: [],
        source: 'Test',
        confidence: 0.5,
        scrapedAt: new Date()
      };

      // Set and get
      await this.cache.set('Test Person', '1990-01-01', 'CA', record);
      const retrieved = await this.cache.get('Test Person', '1990-01-01', 'CA');
      
      const passed = retrieved !== null && retrieved.fullName === 'Test Person';

      // Cleanup
      await this.cache.clear();

      return {
        testName: 'should cache and retrieve records',
        passed,
        details: passed 
          ? 'Successfully cached and retrieved record' 
          : `Cache retrieval failed`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should cache and retrieve records',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    this.results.push(await this.testRecordFusion());
    this.results.push(await this.testRiskScoring());
    this.results.push(await this.testCaching());

    return this.results;
  }

  getResults(): TestResult[] {
    return this.results;
  }
}

// Export for use in test runner
export async function runCriminalRecordsTests(): Promise<TestResult[]> {
  const suite = new CriminalRecordsTestSuite();
  return await suite.runAllTests();
}
