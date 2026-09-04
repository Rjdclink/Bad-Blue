'use strict';

const fs = require('node:fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}

function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const migrationPath = 'server/migrations/045_overflow_self_improvement_support.sql';
const schemaPath = 'server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts';
const enginePath = 'server/selfImprovementEngine.ts';
const dockerPath = 'Dockerfile';

const migration = read(migrationPath);
const schema = read(schemaPath);
const engine = read(enginePath);
const docker = read(dockerPath);

for (const table of [
  'public.subagent_learning_patterns',
  'public.subagent_performance_metrics',
  'public.subagent_self_improvement_actions',
]) {
  must(migrationPath, migration, `CREATE TABLE IF NOT EXISTS ${table}`, `${table} must be provisioned idempotently on Overflow`);
  must(schemaPath, schema, `'${table}'`, `${table} must be required by Overflow readiness`);
}

must(schemaPath, schema, "'045_overflow_self_improvement_support.sql'", 'Overflow schema migration list must include migration 045');
const schemaVersionMatch = schema.match(/const SCHEMA_VERSION = (\d+);/);
if (!schemaVersionMatch || Number(schemaVersionMatch[1]) < 16) {
  throw new Error(`Overflow schema version must be at least 16 for migration 045 (${schemaPath})`);
}
const lockVersionMatch = schema.match(/const LOCK_NAME = 'cryptocrawl:overflow-runtime-schema:v(\d+)'/);
if (!lockVersionMatch || Number(lockVersionMatch[1]) !== Number(schemaVersionMatch[1])) {
  throw new Error(`Overflow schema lock version must match current schema version (${schemaPath})`);
}
must(enginePath, engine, '.from(subAgentLearningPatterns)', 'SelfImprovementEngine must continue using its canonical learning-pattern relation');
must(enginePath, engine, '.from(subAgentPerformanceMetrics)', 'SelfImprovementEngine must continue using its canonical performance-metrics relation');
must(enginePath, engine, '.insert(subAgentSelfImprovementActions)', 'SelfImprovementEngine must continue using its canonical audited action relation');
must(dockerPath, docker, '/045_overflow_self_improvement_support.sql', 'production image must package migration 045');

for (const forbidden of ['pg_cron', 'cron.schedule', 'setInterval(', 'setTimeout(', 'submitOrder', 'sendTransaction']) {
  mustNot(migrationPath, migration, forbidden, 'Overflow self-improvement support migration must not install scheduling or execution authority');
}

console.log('Overflow self-improvement support verification passed');
