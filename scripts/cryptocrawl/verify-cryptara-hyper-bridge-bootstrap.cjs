const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[hyper-bridge-bootstrap] ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[hyper-bridge-bootstrap] ${description}`);
}

const bootstrap = read('server/cryptara-bootstrap-entry.ts');
const bridgeBootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');
const overflowSuperWorker = read('server/services/cryptocrawl/integration/cryptara-overflow-super-worker.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');

// Exact startup order: primary pool contraction -> primary admission governor ->
// dedicated overflow Super Worker/probe -> verified overflow decision -> local
// primary-network silence -> server entry. When overflow is ready, index.ts cannot
// create primary PostgreSQL I/O even if a legacy primary readiness call is reached.
requirePattern(
  bootstrap,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*await\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*overflowBootstrap[\s\S]*PRIMARY-SILENCE[\s\S]*import\('\.\/index\.js'\)/,
  'verified overflow must be resolved and primary silence installed before index.ts loads',
);
requirePattern(
  bootstrap,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]{0,2600}Object\.getPrototypeOf\(pool\)[\s\S]{0,2600}prototype\.connect\s*=\s*function\s+cryptaraPrimarySilenceConnect/,
  'overflow-ready startup must install a process-wide pg.Pool primary acquisition veto',
);
requirePattern(
  bootstrap,
  /targetsPrimary[\s\S]{0,1800}CRYPTARA_PRIMARY_NETWORK_SILENCED_OVERFLOW_ACTIVE[\s\S]{0,1200}Promise\.reject\(error\)/,
  'primary ordinary/coordination acquisitions must fail locally before network I/O',
);
requirePattern(
  bootstrap,
  /primaryConnectionStrings[\s\S]{0,1000}primaryApplicationNames[\s\S]{0,1600}!targetsPrimary[\s\S]{0,500}previousConnect\.call/,
  'the silence guard must discriminate primary pools and leave overflow/non-primary pools untouched',
);
requirePattern(
  bridgeBootstrap,
  /startCryptaraOverflowSuperWorker\(\)[\s\S]{0,900}withCryptaraParallelProxy\('observability'/,
  'dedicated overflow Super Worker must be online before the remote overflow probe',
);

// Reuse-only law: one existing overflow pool/configuration, one single-flight probe,
// no timer/poller, no new aliases, no primary companion query, no authority promotion.
requirePattern(bridgeBootstrap, /withCryptaraParallelProxy\('observability'/, 'bootstrap must reuse the existing overflow worker');
requirePattern(bridgeBootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/, 'bootstrap probe must be single-flight');
requirePattern(bridgeBootstrap, /SELECT 1 AS hyper_bridge_ready/, 'bootstrap must use one minimal auxiliary admission probe');
requirePattern(bridgeBootstrap, /state\s*=\s*'not_configured'/, 'missing overflow configuration must leave the primary fallback path available');
requirePattern(bridgeBootstrap, /no primary probe was issued by overflow worker/, 'overflow failure must never trigger a primary companion probe');
requirePattern(overflowSuperWorker, /primaryDatabaseCalls:\s*0\s+as\s+const/, 'overflow Super Worker must advertise zero primary DB calls');
forbidPattern(bridgeBootstrap, /\bnew\s+Pool\s*\(/, 'bootstrap must not create another PostgreSQL pool');
forbidPattern(bridgeBootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap must not add polling or wall-clock retry loops');
forbidPattern(
  bridgeBootstrap,
  /process\.env\.(?:SUPABASE_DATABASE_URL_OVERFLOW|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL)/,
  'bootstrap must not duplicate connection-variable authority',
);
forbidPattern(bridgeBootstrap, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'overflow bootstrap must not touch the authoritative primary pool');
forbidPattern(overflowSuperWorker, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bnew\s+Pool\s*\(/, 'overflow Super Worker must not touch/create a DB pool');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing overflow worker remains the sole overflow connection-variable authority');

// The wrapper may inspect primary Pool metadata only after overflow is ready. It
// must not perform a primary query itself, create another pool, or add a poller.
forbidPattern(bootstrap, /\bpool\.query\s*\(|\bdb\.execute\s*\(|\bnew\s+Pool\s*\(/, 'primary silence wrapper must remain query-free and pool-free');
forbidPattern(bootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'primary silence wrapper must not add recovery polling');
requirePattern(bootstrap, /primary network I\/O=0/, 'runtime telemetry must explicitly report zero primary network I/O when vetoing an acquisition');

console.log('[hyper-bridge-bootstrap] PASS: verified overflow starts first and installs a process-wide local primary acquisition veto; overflow/non-primary pools remain untouched, primary PostgreSQL I/O is zero while overflow is active, and all authority boundaries remain unchanged');
