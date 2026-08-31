import { pool } from '../db';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../logger';

const log = createLogger('Migrations');
const modulePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(modulePath);

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'migrations'),
    path.resolve(process.cwd(), 'server', 'migrations'),
    moduleDir,
  ];
  const resolved = candidates.find(candidate =>
    fs.existsSync(candidate)
    && fs.statSync(candidate).isDirectory()
    && fs.readdirSync(candidate).some(file => file.endsWith('.sql')),
  );
  if (!resolved) throw new Error('No numbered SQL migration directory is available');
  return resolved;
}

export async function runMigrations() {
  log.info('Starting database migrations');

  const migrationsDir = resolveMigrationsDir();
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

// ESM-safe direct invocation for `npm run migrate` / tsx.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === path.resolve(modulePath)) {
  runMigrations()
    .then(() => {
      log.info('Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log.error('Migration script failed', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
}