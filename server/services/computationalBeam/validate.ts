/**
 * Computational Beam Validation Script
 * 
 * Validates the entire computational beam system is properly structured
 */

import * as fs from 'fs';
import * as path from 'path';

const BEAM_DIR = path.join(__dirname);

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: string;
}

class ComputationalBeamValidator {
  private results: ValidationResult[] = [];

  /**
   * Run all validation checks
   */
  public async validate(): Promise<boolean> {
    console.log('🔍 Starting Computational Beam Validation\n');

    this.checkFileExists('types.ts', 'Core types definition');
    this.checkFileExists('credentialValidator.ts', 'Credential validation system');
    this.checkFileExists('omniAntennaLayer.ts', 'Omni-directional antenna layer');
    this.checkFileExists('directionalBeamLayer.ts', 'Directional beam compute layer');
    this.checkFileExists('superBatteryLayer.ts', 'Super-battery optimization layer');
    this.checkFileExists('workloadRouter.ts', 'Workload router');
    this.checkFileExists('integrityTesting.ts', 'Integrity testing system');
    this.checkFileExists('index.ts', 'Main orchestrator');
    this.checkFileExists('main.ts', 'Module exports');
    this.checkFileExists('README.md', 'Documentation');
    this.checkFileExists('demo.ts', 'Demo script');
    this.checkFileExists('test-integration.ts', 'Integration tests');

    this.checkFileContent('types.ts', 'ComputeProvider', 'Core provider types');
    this.checkFileContent('types.ts', 'ComputeLayer', 'Core layer types');
    this.checkFileContent('types.ts', 'TripleCredentials', 'Credential types');
    this.checkFileContent('types.ts', 'IntegrityTestType', 'Integrity test types');

    this.checkFileContent('credentialValidator.ts', 'validateAll', 'Triple validation');
    this.checkFileContent('credentialValidator.ts', 'validateApplicationAccessKey', 'App key validation');
    this.checkFileContent('credentialValidator.ts', 'validateAdminPanelAuth', 'Admin validation');
    this.checkFileContent('credentialValidator.ts', 'validateCrawlerAuthToken', 'Crawler validation');

    this.checkFileContent('omniAntennaLayer.ts', 'OmniAntennaLayer', 'Antenna class');
    this.checkFileContent('omniAntennaLayer.ts', 'acceptTask', 'Task acceptance');
    this.checkFileContent('omniAntennaLayer.ts', 'routeToNode', 'Task routing');

    this.checkFileContent('directionalBeamLayer.ts', 'DirectionalBeamLayer', 'Beam class');
    this.checkFileContent('directionalBeamLayer.ts', 'executeOnNode', 'Task execution');
    this.checkFileContent('directionalBeamLayer.ts', 'updateNodeHealth', 'Health monitoring');

    this.checkFileContent('superBatteryLayer.ts', 'SuperBatteryLayer', 'Battery class');
    this.checkFileContent('superBatteryLayer.ts', 'optimizeTask', 'Task optimization');
    this.checkFileContent('superBatteryLayer.ts', 'cacheResult', 'Result caching');
    this.checkFileContent('superBatteryLayer.ts', 'addToBatch', 'Batch processing');

    this.checkFileContent('workloadRouter.ts', 'WorkloadRouter', 'Router class');
    this.checkFileContent('workloadRouter.ts', 'routeTask', 'Task routing');
    this.checkFileContent('workloadRouter.ts', 'assessIntensity', 'Intensity assessment');
    this.checkFileContent('workloadRouter.ts', 'selectLayer', 'Layer selection');

    this.checkFileContent('integrityTesting.ts', 'IntegrityTestingSystem', 'Testing class');
    this.checkFileContent('integrityTesting.ts', 'runIntegrityTestA', 'Test A implementation');
    this.checkFileContent('integrityTesting.ts', 'runIntegrityTestB', 'Test B implementation');
    this.checkFileContent('integrityTesting.ts', 'applyPatch', 'Automated patching');

    this.checkFileContent('index.ts', 'ComputationalBeamOrchestrator', 'Orchestrator class');
    this.checkFileContent('index.ts', 'initialize', 'System initialization');
    this.checkFileContent('index.ts', 'executeCrawlerTask', 'Crawler execution');
    this.checkFileContent('index.ts', 'getSystemStatus', 'Status reporting');

    this.checkFileContent('README.md', 'Architecture Layers', 'Documentation structure');
    this.checkFileContent('README.md', 'Triple Credential', 'Security documentation');
    this.checkFileContent('README.md', 'Integrity Testing', 'Testing documentation');

    // Print results
    console.log('\n📊 Validation Results:\n');
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;

    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.message}`);
      if (result.details && !result.passed) {
        console.log(`   ${result.details}`);
      }
    });

    console.log(`\n📈 Score: ${passed}/${total} checks passed (${((passed/total) * 100).toFixed(1)}%)\n`);

    const allPassed = passed === total;
    if (allPassed) {
      console.log('🎉 All validation checks passed!\n');
    } else {
      console.log('⚠️  Some validation checks failed.\n');
    }

    return allPassed;
  }

  /**
   * Check if file exists
   */
  private checkFileExists(filename: string, description: string): void {
    const filepath = path.join(BEAM_DIR, filename);
    const exists = fs.existsSync(filepath);
    
    this.results.push({
      passed: exists,
      message: description,
      details: exists ? undefined : `File not found: ${filename}`,
    });
  }

  /**
   * Check file contains expected content
   */
  private checkFileContent(filename: string, searchString: string, description: string): void {
    const filepath = path.join(BEAM_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      this.results.push({
        passed: false,
        message: description,
        details: `File not found: ${filename}`,
      });
      return;
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    const contains = content.includes(searchString);

    this.results.push({
      passed: contains,
      message: description,
      details: contains ? undefined : `Missing "${searchString}" in ${filename}`,
    });
  }
}

// Run validation if executed directly
if (require.main === module) {
  const validator = new ComputationalBeamValidator();
  validator.validate()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Validation error:', error);
      process.exit(1);
    });
}

export { ComputationalBeamValidator };
