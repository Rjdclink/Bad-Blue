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
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');

// Exact startup order: pool contraction -> admission governor -> auxiliary bridge
// head-start -> server entry -> authoritative primary probe.
requirePattern(
  bootstrap,
  /reconcileAppSchema[\s\S]*installCryptaraSuperWorkerAdmission[\s\S]*startCryptaraHyperBridgeBootstrap[\s\S]*void\s+startCryptaraHyperBridgeBootstrap\(\)[\s\S]*import\('\.\/index\.js'\)/,
  'HyperBridge must start before index.ts can issue the primary SELECT 1 probe',
);
forbidPattern(
  bootstrap,
  /await\s+startCryptaraHyperBridgeBootstrap\(\)/,
  'HyperBridge head-start must not add remote I/O latency to the critical startup path',
);

// Reuse-only law: one existing overflow pool/configuration, one single-flight probe,
// no timer/poller, no new aliases, no primary pool access, no authority promotion.
requirePattern(bridgeBootstrap, /withCryptaraParallelProxy\('observability'/, 'bootstrap must reuse the existing overflow worker');
requirePattern(bridgeBootstrap, /if\s*\(probeInFlight\)\s*return\s+probeInFlight/, 'bootstrap probe must be single-flight');
requirePattern(bridgeBootstrap, /SELECT 1 AS hyper_bridge_ready/, 'bootstrap must use one minimal auxiliary admission probe');
requirePattern(bridgeBootstrap, /state\s*=\s*'not_configured'/, 'missing overflow configuration must degrade locally instead of blocking startup');
requirePattern(bridgeBootstrap, /primary authority remains unchanged/, 'bootstrap must preserve primary authority on auxiliary failure');
forbidPattern(bridgeBootstrap, /\bnew\s+Pool\s*\(/, 'bootstrap must not create another PostgreSQL pool');
forbidPattern(bridgeBootstrap, /setInterval\s*\(|setTimeout\s*\(/, 'bootstrap must not add polling or wall-clock retry loops');
forbidPattern(
  bridgeBootstrap,
  /process\.env\.(?:SUPABASE_DATABASE_URL_OVERFLOW|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL)/,
  'bootstrap must not duplicate connection-variable authority',
);
forbidPattern(bridgeBootstrap, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'bootstrap must not touch the authoritative primary pool');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing overflow worker remains the sole overflow connection-variable authority');

console.log('[hyper-bridge-bootstrap] PASS: existing overflow lane starts single-flight before the authoritative primary probe, adds no awaited startup I/O, creates no new pool/config alias/timer, and preserves primary critical authority');
