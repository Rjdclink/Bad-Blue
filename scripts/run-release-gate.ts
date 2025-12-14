import { runReleaseGateChecks, getReleaseGateSummary } from '../server/lib/releaseGate';

async function main() {
  console.log('Running Release Gate Checks for PASS 4-8...');
  
  try {
    const checks = await runReleaseGateChecks();
    const summary = getReleaseGateSummary(checks);
    
    console.log('\n=== RELEASE GATE RESULTS ===\n');
    
    checks.forEach(check => {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`${icon} [${check.name}]: ${check.message}`);
      if (check.details) {
        console.log('   Details:', JSON.stringify(check.details, null, 2));
      }
    });
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Warnings: ${summary.warnings}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Ready for Deploy: ${summary.readyForDeploy ? 'YES 🚀' : 'NO 🛑'}`);
    
    if (!summary.readyForDeploy) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error running release gate checks:', error);
    process.exit(1);
  }
}

main();
