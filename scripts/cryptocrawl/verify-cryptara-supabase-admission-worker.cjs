'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[cryptara-supabase-worker] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[cryptara-supabase-worker] forbidden regression: ${description}`);
};
const requireFragments = (source, fragments, description) => {
  const missing = fragments.filter(fragment => !source.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`[cryptara-supabase-worker] missing invariant: ${description}; missing=${missing.join(' | ')}`);
  }
};

const worker = read('server/services/cryptocrawl/integration/cryptara-supabase-admission-worker.ts');
const governance = read('server/services/cryptocrawl/governance/index.ts');
const stageState = read('server/services/cryptocrawl/governance/stage-state-store.ts');
const executionLedger = read('server/services/cryptocrawl/execution/adapters/stage4-execution-ledger.ts');
const resourceScheduler = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const distributedQuota = read('server/services/cryptocrawl/execution/distributed-api-quota.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const calibration = read('server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts');
const migration = read('server/migrations/023_cryptocrawler_hot_path_schema_authority.sql');

// One resource brain, zero extra connection budget.
requirePattern(worker, /import\s+\{\s*getPoolStats,\s*pool\s*\}\s+from\s+'\.\.\/\.\.\/\.\.\/db\.js'/, 'worker consumes the existing ordinary pool and its telemetry');
forbidPattern(worker, /\bnew\s+Pool\s*\(/, 'worker creating a second application pool');
forbidPattern(worker, /coordinationPool/, 'worker consuming or modifying the session-capable coordination lane');
forbidPattern(worker, /setInterval\s*\(/, 'polling loop adding idle worker overhead');
requirePattern(worker, /pressureResumeTimer:\s*NodeJS\.Timeout\s*\|\s*null/, 'pressure backoff uses one reusable one-shot timer');
requirePattern(worker, /setTimeout\([\s\S]{0,220}this\.pressureResumeTimer\s*=\s*null;[\s\S]{0,120}this\.drain\(\)/, 'pressure cooldown resumes queued work once without polling');
requirePattern(worker, /pressureResumeTimer\.unref\?\.\(\)/, 'pressure cooldown timer never keeps the process alive');
requirePattern(worker, /pressureActive\s*&&\s*stats\.idle\s*===\s*0/, 'pressure cooldown waits when no reusable idle client exists');
requirePattern(worker, /admissionBudget\s*=\s*pressureActive[\s\S]{0,120}Math\.min\(targetSlots,\s*Math\.max\(0,\s*stats\.idle\)\)/, 'pressure-mode admission cannot exceed already-idle reusable clients');
requirePattern(worker, /while\s*\(admitted\s*<\s*admissionBudget/, 'each pressure drain pass obeys its measured reuse budget');
requirePattern(worker, /if\s*\(this\s*!==\s*pool\)/, 'only the live ordinary pool is admitted through Cryptara');
requirePattern(worker, /Pool\.prototype/, 'shared ordinary callers converge on one acquisition gate');

// Start at the already-safe effective pool ceiling. These assertions are
// deliberately fragment-based: formatting/comments must never turn a valid
// invariant into a false deployment failure.
requireFragments(worker, [
  'primeToCurrentPoolCapacity(): void',
  'const ceiling = Math.max(1, Math.trunc(stats.max || 1));',
  'if (stats.waiting > 0)',
  'Math.floor(ceiling / 2)',
  'this.targetConcurrency = ceiling;',
  'governor.primeToCurrentPoolCapacity();',
  'installed = true;',
], 'worker starts from the effective pool ceiling and contracts only on measured local pressure');

// Dynamic pressure response: multiplicative decrease, additive recovery, bounded by live pool max.
requirePattern(worker, /Math\.floor\(this\.targetConcurrency\s*\/\s*2\)/, 'multiplicative pressure contraction');
requirePattern(worker, /this\.targetConcurrency\s*\+\s*1/, 'additive healthy recovery');
requirePattern(worker, /Math\.min\(ceiling,\s*this\.targetConcurrency\s*\+\s*1\)/, 'recovery never exceeds the current pool ceiling');
requirePattern(worker, /stats\.waiting\s*>\s*0/, 'live pool waiters are a pressure signal');
requirePattern(worker, /PRESSURE_ACQUIRE_MS/, 'measured admission latency feeds the pressure decision');
requirePattern(worker, /PRESSURE_HOLD_MS/, 'sustained checkouts with queued work feed the pressure decision');
requirePattern(worker, /53300/, 'Postgres too-many-connections pressure classification');
requirePattern(worker, /57p03/i, 'Postgres cannot-connect-now pressure classification');
requirePattern(worker, /08006[\s\S]{0,160}timeoutContext/, '08006 is treated as pressure only with timeout/termination context');
requirePattern(worker, /connection terminated due to connection timeout/i, 'observed Supabase connection timeout classification');

// Preserve capability: queue all work, prioritize without starvation, and release every permit.
requirePattern(worker, /this\.queue\.push\s*\(/, 'work is queued rather than discarded when capacity is occupied');
requirePattern(worker, /AGE_PROMOTION_MS/, 'priority aging prevents low-priority starvation');
requirePattern(worker, /contextualPriority\s*\|\|\s*'normal'/, 'unclassified callers keep neutral priority rather than gaining accidental authority');
requirePattern(worker, /finally\s*\{[\s\S]{0,160}permit\.release/, 'client release always returns the worker permit');
requirePattern(worker, /permit\.release\(undefined,\s*0\)/, 'failed acquisitions return their worker permit without double-counting pressure');
requirePattern(worker, /try\s*\{[\s\S]{0,200}originalConnect\.call\(this,[\s\S]{0,1800}catch\s*\(error\)\s*\{[\s\S]{0,120}permit\.release\(undefined,\s*0\)/, 'callback-style synchronous connection failures cannot leak worker permits');
requirePattern(worker, /if\s*\(released\)[\s\S]{0,320}originalRelease\(error\)/, 'node-postgres double-release semantics are preserved');
forbidPattern(worker, /queue\.length[^\n]{0,100}(throw|reject|shift\(\)\s*;\s*return)/, 'queue-overflow task dropping');

// Cryptara controls resource admission only; business/execution authority remains elsewhere.
requirePattern(worker, /governor:\s*'cryptara'/, 'Cryptara is the named resource governor');
requirePattern(worker, /authority:\s*'resource_admission_only'/, 'resource-only authority boundary');
requirePattern(worker, /writeAuthority:\s*false/, 'worker has no independent write authority');
requirePattern(worker, /executionAuthority:\s*false/, 'worker has no execution authority');

// Install after migration admission but before governance persistence and heavyweight route import.
requirePattern(governance, /installCryptaraSupabaseAdmissionWorker\(\)[\s\S]{0,500}stageManager\.restorePersistence/, 'worker is installed before governance persistence begins');
requirePattern(stageState, /withCryptaraSupabasePriority\('critical',[\s\S]{0,160}pool\.query/, 'governance reads use critical resource priority');
requirePattern(stageState, /withCryptaraSupabasePriority\('critical',[\s\S]{0,160}pool\.connect/, 'governance transactions use critical resource priority');
requirePattern(executionLedger, /function\s+highPriorityQuery[\s\S]{0,260}withCryptaraSupabasePriority\('high',[\s\S]{0,120}pool\.query/, 'Stage-4 execution ledger persistence receives high resource priority');
forbidPattern(executionLedger, /withCryptaraSupabasePriority\('critical'/, 'execution ledger outranking canonical governance persistence');

// Execution-facing database admission shares the same worker rather than creating
// another pool/worker. Cleanup remains subordinate to live opportunity ownership.
requireFragments(resourceScheduler, [
  "withCryptaraSupabasePriority('high', () => pool.connect())",
  "withCryptaraSupabasePriority('low', () => pool.query(text, values))",
  'this.cleanupInFlight = lowPriorityQuery',
], 'execution leasing is high priority and expired-lease cleanup is low priority');
forbidPattern(resourceScheduler, /\bnew\s+Pool\s*\(/, 'resource scheduler creating an independent database pool');
requireFragments(distributedQuota, [
  "withCryptaraSupabasePriority('high', () => pool.connect())",
  'function quotaRetryDelayMs',
  'Math.random()',
  'boundedBase + extra',
], 'distributed quota claims are high priority and retries add only upward jitter');
forbidPattern(distributedQuota, /\bnew\s+Pool\s*\(/, 'distributed quota creating an independent database pool');

// Slot collision scans are migration-owned and happen inside PostgreSQL. Verify
// the semantic pieces individually rather than relying on source-character
// distances, while still requiring the atomic expired-lease takeover rule.
requireFragments(migration, [
  'CREATE OR REPLACE FUNCTION private.cryptocrawler_claim_resource_slot(',
  'FOR v_offset IN 0..(p_capacity - 1) LOOP',
  'INSERT INTO public.cryptocrawler_resource_leases AS leases',
  'ON CONFLICT (resource_key) DO UPDATE',
  'WHERE leases.expires_at <= now()',
  'RETURNING resource_key INTO v_claimed_key;',
  'RETURN v_claimed_key;',
  'GRANT EXECUTE ON FUNCTION private.cryptocrawler_claim_resource_slot',
], 'server-side slot scan preserves the atomic collision and authorization contract');
requireFragments(resourceScheduler, [
  'private async claimResourceSlot(',
  'SELECT ${CLAIM_FUNCTION}($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) AS resource_key',
  "to_regprocedure('private.cryptocrawler_claim_resource_slot",
], 'execution resource domains use the migration-owned single-call slot claimant');
requireFragments(distributedQuota, [
  'SELECT ${CLAIM_FUNCTION}($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) AS resource_key',
  "to_regprocedure('private.cryptocrawler_claim_resource_slot",
], 'distributed quota uses the migration-owned single-call slot claimant');
forbidPattern(resourceScheduler, /for\s*\(let\s+slot\s*=\s*0;\s*slot\s*<\s*spec\.capacity/, 'client-side execution slot scan returning');
forbidPattern(distributedQuota, /for\s*\(let\s+offset\s*=\s*0;\s*offset\s*<\s*capacity/, 'client-side quota slot scan returning');

// Terminal-confirmed money-state durability is critical, but still uses the same
// ordinary pool. The default compounding path must not repeat two idempotency reads.
requireFragments(retainedProfit, [
  "withCryptaraSupabasePriority('critical', () => pool.connect())",
  'SELECT * FROM (',
  "'payout'::text AS source",
  'UNION ALL',
  "'retained'::text AS source",
  'ORDER BY precedence',
  'LIMIT 1',
  'function persistenceRetryDelayMs',
  'Math.random()',
  "withCryptaraSupabasePriority('high', async () =>",
  "to_regclass('private.cryptocrawler_rainbow_profit_events')",
], 'terminal profit persistence is critical, call-coalesced, jittered and schema-gated');
forbidPattern(retainedProfit, /const\s+existingPayout\s*=\s*await\s+client\.query/, 'separate legacy payout idempotency read returning');
forbidPattern(retainedProfit, /const\s+existingRetained\s*=\s*await\s+client\.query/, 'separate retained-event idempotency read returning');
forbidPattern(retainedProfit, /\bnew\s+Pool\s*\(/, 'retained-profit ledger creating an independent database pool');

// Remove redundant runtime DDL while preserving migration-owned persistence and
// classify learning persistence below governance/settlement work during pressure.
requirePattern(migration, /CREATE TABLE IF NOT EXISTS public\.cryptocrawler_mc_calibration_v1/, 'migration owns Monte Carlo calibration schema');
requirePattern(calibration, /to_regclass\(\$1::text\)/, 'runtime verifies the migration-owned calibration relation');
forbidPattern(calibration, /CREATE\s+(TABLE|INDEX)[\s\S]{0,120}cryptocrawler_mc_calibration_v1/i, 'runtime Monte Carlo DDL and associated lock pressure');
requirePattern(calibration, /withCryptaraSupabasePriority\('low',[\s\S]{0,260}SELECT to_regclass/, 'calibration schema verification is background-priority work');
requirePattern(calibration, /withCryptaraSupabasePriority\('low',[\s\S]{0,260}SELECT payload FROM/, 'calibration hydration is background-priority work');
requirePattern(calibration, /withCryptaraSupabasePriority\('low',[\s\S]{0,260}INSERT INTO/, 'terminal calibration persistence is background-priority work');
requirePattern(calibration, /INSERT INTO \$\{TABLE\}/, 'terminal calibration persistence remains active');
requirePattern(calibration, /SELECT payload FROM \$\{TABLE\}/, 'calibration hydration remains active');

console.log('[cryptara-supabase-worker] adaptive ordinary-lane admission, full effective startup capacity, idle-reuse pressure budgeting, jittered recovery, zero-extra-pool, critical/high/normal/low task priority, execution/quota prioritization, server-side slot call coalescing, terminal-profit call coalescing, authority isolation, starvation protection, and migration-owned persistence invariants passed');
