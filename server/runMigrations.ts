// Migration runner script
// Run with: npm run migrate or tsx server/runMigrations.ts

import { runAllSchemaMigrations } from './migrations/reconcileAppSchema';

async function runAllMigrations() {
  console.log('='.repeat(60));
  console.log('Running database migrations...');
  console.log('='.repeat(60));
  
  try {
    const results = await runAllSchemaMigrations({ continueOnError: true });

    let failed = 0;
    for (const result of results) {
      console.log(`\nMigration: ${result.name}`);
      console.log('-'.repeat(40));

      if (result.success) {
        console.log(`✓ ${result.message ?? 'Completed successfully'}`);
      } else {
        failed += 1;
        console.log(`✗ ${result.error ?? 'Unknown error'}`);
      }
    }

    if (failed > 0) {
      throw new Error(`${failed} migration step(s) failed`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✓ All migrations completed successfully');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ Migration failed:', error);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// Run migrations
runAllMigrations();