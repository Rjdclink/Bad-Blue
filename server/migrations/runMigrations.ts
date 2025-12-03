import { pool } from '../db';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('Migrations');

export async function runMigrations() {
  log.info('Starting database migrations');

  const migrationsDir = __dirname;
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    log.info('Running migration', { file });
    
    const filePath = path.join(migrationsDir, file);
    const migrationSQL = fs.readFileSync(filePath, 'utf8');
    
    try {
      await pool.query(migrationSQL);
      log.info('Migration completed', { file });
    } catch (error) {
      log.error('Migration failed', { file, error: (error as Error).message });
      throw error;
    }
  }

  log.info('All migrations completed successfully');
}

// If run directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      log.info('Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log.error('Migration script failed', { error: error.message });
      process.exit(1);
    });
}
