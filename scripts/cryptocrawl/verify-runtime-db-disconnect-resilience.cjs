'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts'),
  'utf8',
);

function requirePattern(pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`[runtime-db-disconnect-resilience] missing invariant: ${description}`);
  }
}

function forbidPattern(pattern, description) {
  if (pattern.test(source)) {
    throw new Error(`[runtime-db-disconnect-resilience] forbidden regression: ${description}`);
  }
}

const poolConstructionCount = (source.match(/\bnew\s+Pool\s*\(/g) || []).length;
if (poolConstructionCount !== 2) {
  throw new Error(`[runtime-db-disconnect-resilience] canonical runtime must keep exactly two pools; observed=${poolConstructionCount}`);
}

requirePattern(/function\s+attachCheckedOutClientErrorGuard\s*\(/, 'checked-out client disconnect guard exists');
requirePattern(/targetPool\.on\('acquire',[\s\S]{0,900}client\.on\('error',\s*guard\)/, 'guard attaches while a client is checked out');
requirePattern(/targetPool\.on\('release',[\s\S]{0,500}client\.removeListener\('error',\s*guard\)[\s\S]{0,180}activeGuards\.delete\(client\)/, 'guard is removed when node-postgres restores idle handling');
requirePattern(/targetPool\.on\('remove',[\s\S]{0,500}activeGuards\.delete\(client\)/, 'removed clients cannot retain guard bookkeeping');
requirePattern(/attachCheckedOutClientErrorGuard\(nextPool,\s*'ordinary'\)/, 'ordinary Overflow runtime lane is guarded on every lifecycle recreation');
requirePattern(/attachCheckedOutClientErrorGuard\(nextPool,\s*'coordination'\)/, 'coordination Overflow runtime lane is guarded on every lifecycle recreation');
requirePattern(/createOrdinaryPool[\s\S]{0,900}nextPool\.on\('error'/, 'ordinary pool idle-client handler remains installed on recreation');
requirePattern(/createCoordinationPool[\s\S]{0,900}nextPool\.on\('error'/, 'coordination pool idle-client handler remains installed on recreation');
requirePattern(/closeCryptocrawlRuntimeDatabasePools[\s\S]{0,500}ordinary\.end\(\)[\s\S]{0,180}coordination\.end\(\)/, 'master stop explicitly closes both CryptoCrawler database pools');
requirePattern(/reopenCryptocrawlRuntimeDatabasePools[\s\S]{0,500}createOrdinaryPool\(\)[\s\S]{0,220}createCoordinationPool\(\)/, 'manual restart recreates both pools');
requirePattern(/processShutdownAuthority:\s*false/, 'checked-out disconnects have no process-shutdown authority');

const guardFunction = source.match(/function\s+attachCheckedOutClientErrorGuard[\s\S]*?\n}\n\nfunction\s+installManualPowerDatabaseGuard/)?.[0] || '';
if (!guardFunction) {
  throw new Error('[runtime-db-disconnect-resilience] could not isolate disconnect guard');
}
if (/\.release\s*\(/.test(guardFunction)) {
  throw new Error('[runtime-db-disconnect-resilience] disconnect guard must not double-release caller-owned clients');
}
if (/setInterval\s*\(|setTimeout\s*\(/.test(guardFunction)) {
  throw new Error('[runtime-db-disconnect-resilience] disconnect guard must not add an independent retry/polling authority');
}

forbidPattern(/SUPABASE_DATABASE_URL(?!_OVERFLOW)/, 'Primary database fallback appearing in canonical CryptoCrawler runtime DB');
forbidPattern(/process\.exit\s*\(/, 'database disconnect handler terminating the process');

console.log('[runtime-db-disconnect-resilience] checked-out/idle disconnect handling plus explicit close/reopen lifecycle preserved without extra pool authority, retries, Primary fallback, or execution authority');
