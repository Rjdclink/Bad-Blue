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

// Start at the already-safe effective pool ceiling. Railway rollout headroom is
// applied before this worker installs, so a healthy replica keeps full permitted
// parallelism instead of climbing from an arbitrary concurrency of one.
requirePattern(worker, /primeToCurrentPoolCapacity\(\)/, 'worker primes itself from the current effective pool capacity');
requirePattern(worker, /this\.targetConcurrency\s*=\s*ceiling/, 'healthy startup begins at the current effective pool ceiling');
requirePattern(worker, /if\s*\(stats\.waiting\s*>\s*0\)[\s\S]{0,220}Math\.floor\(ceiling\s*\/\s*2\)/, 'existing local pressure can still contract initial admission');
requirePattern(worker, /governor\.primeToCurrentPoolCapacity\(\)[\s\S]{0,120}installed\s*=\s*true/, 'pool-capacity priming occurs during worker installation');

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
requirePattern(resourceScheduler, /withCryptaraSupabasePriority\('high',[\s\S]{0,120}pool\.connect/, 'execution resource lease acquisition receives high priority');
requirePattern(resourceScheduler, /function\s+lowPriorityQuery[\s\S]{0,180}withCryptaraSupabasePriority\('low'/, 'lease cleanup receives low priority');
requirePattern(resourceScheduler, /this\.cleanupInFlight\s*=\s*lowPriorityQuery/, 'expired-lease cleanup cannot outrank live resource leasing');
forbidPattern(resourceScheduler, /\bnew\s+Pool\s*\(/, 'resource scheduler creating an independent database pool');
requirePattern(distributedQuota, /withCryptaraSupabasePriority\('high',[\s\S]{0,120}pool\.connect/, 'distributed API quota claims receive high priority');
requirePattern(distributedQuota, /quotaRetryDelayMs[\s\S]{0,420}Math\.random/, 'distributed quota retries are jittered across replicas');
requirePattern(distributedQuota, /boundedBase\s*\+\s*extra/, 'quota jitter never deliberately wakes before the database-derived wait estimate');
forbidPattern(distributedQuota, /\bnew\s+Pool\s*\(/, 'distributed quota creating an independent database pool');

// Slot collision scans are migration-owned and happen inside PostgreSQL. This is
// the call-coalescing optimization: one client round trip per slot domain while
// retaining the same atomic ON CONFLICT takeover rule for expired leases.
requirePattern(migration, /CREATE OR REPLACE FUNCTION private\.cryptocrawler_claim_resource_slot/, 'migration owns the server-side resource-slot claim function');
requirePattern(migration, /FOR\s+v_offset\s+IN\s+0\.\.\(p_capacity\s*-\s*1\)\s+LOOP[\s\S]{0,1600}ON CONFLICT \(resource_key\) DO UPDATE[\s\S]{0,700}RETURN v_claimed_key/, 'server-side slot scan preserves atomic collision semantics');
requirePattern(resourceScheduler, /private async claimResourceSlot[\s\S]{0,700}SELECT \$\{CLAIM_FUNCTION\}/, 'execution resource domains use one server-side slot-claim call');
requirePattern(distributedQuota, /SELECT \$\{CLAIM_FUNCTION\}[\s\S]{0,300}AS resource_key/, 'distributed quota uses one server-side slot-claim call');
forbidPattern(resourceScheduler, /for\s*\(let\s+slot\s*=\s*0;\s*slot\s*<\s*spec\.capacity/, 'client-side execution slot scan returning');
forbidPattern(distributedQuota, /for\s*\(let\s+offset\s*=\s*0;\s*offset\s*<\s*capacity/, 'client-side quota slot scan returning');
requirePattern(resourceScheduler, /to_regprocedure\('private\.cryptocrawler_claim_resource_slot/, 'resource scheduler verifies migration-owned slot function before use');
requirePattern(distributedQuota, /to_regprocedure\('private\.cryptocrawler_claim_resource_slot/, 'quota scheduler verifies migration-owned slot function before use');

// Terminal-confirmed money-state durability is critical, but still uses the same
// ordinary pool. The default compounding path must not repeat two idempotency reads.
requirePattern(retainedProfit, /withCryptaraSupabasePriority\('critical',[\s\S]{0,120}pool\.connect/, 'terminal realized-profit transaction receives critical priority');
requirePattern(retainedProfit, /SELECT \* FROM \([\s\S]{0,900}UNION ALL[\s\S]{0,900}ORDER BY precedence[\s\S]{0,120}LIMIT 1/, 'legacy payout and retained-event idempotency are coalesced into one precedence-preserving read');
forbidPattern(retainedProfit, /const\s+existingPayout\s*=\s*await\s+client\.query/, 'separate legacy payout idempotency read returning');
forbidPattern(retainedProfit, /const\s+existingRetained\s*=\s*await\s+client\.query/, 'separate retained-event idempotency read returning');
requirePattern(retainedProfit, /function\s+persistenceRetryDelayMs[\s\S]{0,420}Math\.random/, 'terminal-profit retry timing is bounded and jittered');
requirePattern(retainedProfit, /withCryptaraSupabasePriority\('high',\s*async\s*\(\)\s*=>[\s\S]{0,220}to_regclass/, 'profit schema verification is high priority without becoming critical authority');
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
