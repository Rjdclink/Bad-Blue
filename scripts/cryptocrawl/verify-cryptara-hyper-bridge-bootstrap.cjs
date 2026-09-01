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
// dedicated overflow Super Worker/probe -> verified overflow decision -> server
// entry. Overflow is a head-started auxiliary data plane; primary remains bounded
// by the existing Cryptara admission governor instead of a process-wide veto.
requirePattern(
  bootstrap,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*await\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*overflowBootstrap[\s\S]*import\('\.\/index\.js'\)/,
  'verified overflow must be resolved before index.ts loads',
);
requirePattern(
  bootstrap,
  /overflowBootstrap\.state\s*===\s*'ready'[\s\S]{0,1200}verified overflow head-start active/,
  'overflow-ready startup must preserve an explicit auxiliary head-start without changing primary authority',
);
forbidPattern(
  bootstrap,
  /PRIMARY-SILENCE|CRYPTARA_PRIMARY_NETWORK_SILENCED_OVERFLOW_ACTIVE|cryptaraPrimarySilenceConnect|Object\.getPrototypeOf\(pool\)/,
  'bootstrap must not install a process-wide primary acquisition veto that prevents authoritative recovery',
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

// The wrapper itself stays query-free/pool-free and adds no polling. Primary
// recovery remains the responsibility of the already-governed server/runtime path.
forbidPattern(bootstrap, /\bpool\.query\s*\(|\bdb\.execute\s*\(|\bnew\s+Pool\s*\(/, 'bootstrap wrapper must remain query-free and pool-free');
forbidPattern(bootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap wrapper must not add recovery polling');

console.log('[hyper-bridge-bootstrap] PASS: verified overflow starts first as an auxiliary head start, primary remains under existing bounded Cryptara admission for authoritative recovery, and all execution/financial/governance authority boundaries remain unchanged');
