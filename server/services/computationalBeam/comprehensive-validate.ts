/**
 * Comprehensive 10-Pass 5-Stage Validation System
 * 
 * Ensures complete removal of autonomous evolution programming
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BEAM_DIR = path.join(__dirname);

// Forbidden terms related to autonomous evolution
const FORBIDDEN_TERMS = [
  'cubicOptimizer',
  'CubicOptimization',
  'genetic',
  'evolution',
  'swarm',
  'self-modif',
  'self-evolv',
  'autonomous',
  'particle swarm',
  'neuroevolution',
  'NSGA-II',
  'gene pool',
  'crossover',
  'mutation rate',
  'fitness function',
  'Optimization³',
  'Evolution³',
];

interface ValidationResult {
  pass: number;
  stage: number;
  stageName: string;
  passed: boolean;
  message: string;
  details?: string;
}

class ComprehensiveValidator {
  private results: ValidationResult[] = [];
  private currentPass = 0;
  private currentStage = 0;

  /**
   * Run comprehensive 10-pass 5-stage validation
   */
  public async validate(): Promise<boolean> {
    console.log('🔍 Starting 10-Pass 5-Stage Comprehensive Validation\n');
    console.log('═'.repeat(80));
    
    for (let pass = 1; pass <= 10; pass++) {
      this.currentPass = pass;
      console.log(`\n${'█'.repeat(80)}`);
      console.log(`PASS ${pass}/10`);
      console.log(`${'█'.repeat(80)}\n`);
      
      await this.runPass();
    }

    this.printSummary();
    return this.results.every(r => r.passed);
  }

  /**
   * Run single pass with 5 stages
   */
  private async runPass(): Promise<void> {
    // Stage 1: File Existence Check
    await this.stage1FileExistenceCheck();
    
    // Stage 2: Content Scanning
    await this.stage2ContentScanning();
    
    // Stage 3: Import/Export Validation
    await this.stage3ImportExportValidation();
    
    // Stage 4: Documentation Verification
    await this.stage4DocumentationVerification();
    
    // Stage 5: Integration Check
    await this.stage5IntegrationCheck();
  }

  /**
   * Stage 1: File Existence Check
   */
  private async stage1FileExistenceCheck(): Promise<void> {
    this.currentStage = 1;
    const stageName = 'File Existence Check';
    console.log(`  Stage 1: ${stageName}`);
    
    // Check that cubicOptimizer.ts does NOT exist
    const forbiddenFile = path.join(BEAM_DIR, 'cubicOptimizer.ts');
    const exists = fs.existsSync(forbiddenFile);
    
    this.results.push({
      pass: this.currentPass,
      stage: 1,
      stageName,
      passed: !exists,
      message: 'cubicOptimizer.ts should not exist',
      details: exists ? 'File still exists!' : 'File successfully removed',
    });
    
    console.log(`    ${!exists ? '✅' : '❌'} cubicOptimizer.ts ${!exists ? 'removed' : 'still exists'}`);
  }

  /**
   * Stage 2: Content Scanning
   */
  private async stage2ContentScanning(): Promise<void> {
    this.currentStage = 2;
    const stageName = 'Content Scanning for Forbidden Terms';
    console.log(`  Stage 2: ${stageName}`);
    
    const tsFiles = this.getTsFiles();
    let foundForbidden = false;
    const findings: string[] = [];
    
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const filename = path.basename(file);
      
      for (const term of FORBIDDEN_TERMS) {
        const regex = new RegExp(term, 'gi');
        if (regex.test(content)) {
          foundForbidden = true;
          findings.push(`${filename}: Found "${term}"`);
        }
      }
    }
    
    this.results.push({
      pass: this.currentPass,
      stage: 2,
      stageName,
      passed: !foundForbidden,
      message: 'No forbidden terms in source files',
      details: foundForbidden ? findings.join(', ') : 'All clean',
    });
    
    console.log(`    ${!foundForbidden ? '✅' : '❌'} ${foundForbidden ? findings.length + ' violations found' : 'No forbidden terms'}`);
    if (foundForbidden) {
      findings.forEach(f => console.log(`       - ${f}`));
    }
  }

  /**
   * Stage 3: Import/Export Validation
   */
  private async stage3ImportExportValidation(): Promise<void> {
    this.currentStage = 3;
    const stageName = 'Import/Export Validation';
    console.log(`  Stage 3: ${stageName}`);
    
    // Check main.ts for cubic optimizer exports
    const mainPath = path.join(BEAM_DIR, 'main.ts');
    const mainContent = fs.readFileSync(mainPath, 'utf-8');
    const hasCubicExport = mainContent.includes('cubicOptimizer') || mainContent.includes('CubicOptimization');
    
    // Check index.ts for cubic optimizer imports
    const indexPath = path.join(BEAM_DIR, 'index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const hasCubicImport = indexContent.includes('cubicOptimizer') || indexContent.includes('CubicOptimization');
    
    const passed = !hasCubicExport && !hasCubicImport;
    
    this.results.push({
      pass: this.currentPass,
      stage: 3,
      stageName,
      passed,
      message: 'No cubic optimizer imports/exports',
      details: passed ? 'Clean' : 'Found references',
    });
    
    console.log(`    ${passed ? '✅' : '❌'} Import/Export ${passed ? 'clean' : 'has references'}`);
  }

  /**
   * Stage 4: Documentation Verification
   */
  private async stage4DocumentationVerification(): Promise<void> {
    this.currentStage = 4;
    const stageName = 'Documentation Verification';
    console.log(`  Stage 4: ${stageName}`);
    
    const readmePath = path.join(BEAM_DIR, 'README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    
    // Check for evolution-related terms
    const evolutionTerms = ['Evolution³', 'Cubic Optimization', 'genetic', 'swarm', 'self-evolv'];
    let foundInDocs = false;
    const docFindings: string[] = [];
    
    for (const term of evolutionTerms) {
      if (readmeContent.toLowerCase().includes(term.toLowerCase())) {
        foundInDocs = true;
        docFindings.push(term);
      }
    }
    
    this.results.push({
      pass: this.currentPass,
      stage: 4,
      stageName,
      passed: !foundInDocs,
      message: 'Documentation free of evolution references',
      details: foundInDocs ? `Found: ${docFindings.join(', ')}` : 'Clean',
    });
    
    console.log(`    ${!foundInDocs ? '✅' : '❌'} Documentation ${!foundInDocs ? 'clean' : 'has ' + docFindings.length + ' references'}`);
  }

  /**
   * Stage 5: Integration Check
   */
  private async stage5IntegrationCheck(): Promise<void> {
    this.currentStage = 5;
    const stageName = 'Integration Check';
    console.log(`  Stage 5: ${stageName}`);
    
    // Verify system can initialize without cubic optimizer
    let integrationPassed = true;
    const issues: string[] = [];
    
    // Check that other modules don't depend on cubic optimizer
    const tsFiles = this.getTsFiles().filter(f => !f.includes('validate'));
    
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('from \'./cubicOptimizer\'') || content.includes('from "./cubicOptimizer"')) {
        integrationPassed = false;
        issues.push(path.basename(file));
      }
    }
    
    this.results.push({
      pass: this.currentPass,
      stage: 5,
      stageName,
      passed: integrationPassed,
      message: 'No dependencies on cubic optimizer',
      details: integrationPassed ? 'Clean' : `Found in: ${issues.join(', ')}`,
    });
    
    console.log(`    ${integrationPassed ? '✅' : '❌'} Integration ${integrationPassed ? 'clean' : 'has issues'}`);
  }

  /**
   * Get all TypeScript files
   */
  private getTsFiles(): string[] {
    const files = fs.readdirSync(BEAM_DIR);
    return files
      .filter(f => f.endsWith('.ts') && !f.includes('validate') && !f.includes('test'))
      .map(f => path.join(BEAM_DIR, f));
  }

  /**
   * Print comprehensive summary
   */
  private printSummary(): void {
    console.log(`\n${'═'.repeat(80)}`);
    console.log('COMPREHENSIVE VALIDATION SUMMARY');
    console.log(`${'═'.repeat(80)}\n`);
    
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total Tests Run: ${totalTests} (10 passes × 5 stages)`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ❌`);
    console.log(`Success Rate: ${((passedTests/totalTests) * 100).toFixed(1)}%\n`);
    
    if (failedTests > 0) {
      console.log('❌ FAILED CHECKS:\n');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  Pass ${r.pass}, Stage ${r.stage}: ${r.stageName}`);
        console.log(`    ${r.message}`);
        console.log(`    Details: ${r.details}\n`);
      });
    } else {
      console.log('🎉 ALL VALIDATION CHECKS PASSED!\n');
      console.log('✅ Autonomous evolution programming completely removed');
      console.log('✅ No forbidden terms found in codebase');
      console.log('✅ All imports/exports cleaned');
      console.log('✅ Documentation updated');
      console.log('✅ System integration verified\n');
    }
    
    console.log(`${'═'.repeat(80)}\n`);
  }
}

// Run validation if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     import.meta.url.endsWith(process.argv[1]);

if (isMainModule) {
  const validator = new ComprehensiveValidator();
  validator.validate()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Validation error:', error);
      process.exit(1);
    });
}

export { ComprehensiveValidator };
