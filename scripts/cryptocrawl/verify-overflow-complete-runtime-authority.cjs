'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.cwd();
const cryptoRoot = path.join(repoRoot, 'server/services/cryptocrawl');
const runtimePoolOwner = 'server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts';
const transformedAuxiliaryPoolOwner = 'server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts';
const rootDb = path.normalize(path.join(repoRoot, 'server/db'));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function importSpecifiers(source) {
  const matches = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) matches.push(match[1]);
  }
  return matches;
}

function resolvesToRootDb(file, specifier) {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.normalize(path.resolve(path.dirname(file), specifier.replace(/\.(?:js|ts|mjs|cjs)$/, '')));
  return resolved === rootDb;
}

const violations = [];
const files = walk(cryptoRoot);
const directDbImports = [];
const postgresPoolOwners = [];
for (const file of files) {
  const rel = relative(file);
  const source = fs.readFileSync(file, 'utf8');

  for (const specifier of importSpecifiers(source)) {
    if (resolvesToRootDb(file, specifier)) {
      directDbImports.push({ file: rel, specifier });
    }
  }

  // Count only actual node-postgres pools. CryptoCrawler also has domain classes
  // named Pool (for example the worker-thread Monte Carlo pool); those are not DB
  // authorities and must not be treated as one.
  const importsPg = /from\s+['"]pg['"]|require\s*\(\s*['"]pg['"]\s*\)/.test(source);
  const pgPoolCreations = importsPg ? [...source.matchAll(/\bnew\s+(?:pg\.)?Pool\s*\(/g)].length : 0;
  if (pgPoolCreations > 0) postgresPoolOwners.push({ file: rel, count: pgPoolCreations });
  if (pgPoolCreations > 0 && rel !== runtimePoolOwner && rel !== transformedAuxiliaryPoolOwner) {
    violations.push(`${rel}: creates ${pgPoolCreations} node-postgres Pool instance(s) outside the verified Overflow pool owners`);
  }

  if (rel !== runtimePoolOwner && /CRYPTOCRAWL_COORDINATION_DATABASE_URL/.test(source)) {
    violations.push(`${rel}: alternate coordination database authority is forbidden`);
  }

  // The one legacy Overflow worker still contains a Primary identity-comparison
  // helper in source, but the production build must remove it before bundling.
  if (rel !== transformedAuxiliaryPoolOwner && /process\.env\.SUPABASE_DATABASE_URL(?!_OVERFLOW)/.test(source)) {
    violations.push(`${rel}: reads Primary SUPABASE_DATABASE_URL inside CryptoCrawler`);
  }
}

const runtimeDb = fs.readFileSync(path.join(cryptoRoot, 'runtime/cryptocrawl-runtime-database.ts'), 'utf8');
const schema = fs.readFileSync(path.join(cryptoRoot, 'runtime/cryptocrawl-overflow-runtime-schema.ts'), 'utf8');
const coordination = fs.readFileSync(path.join(cryptoRoot, 'runtime/database-coordination.ts'), 'utf8');
const bootstrap = fs.readFileSync(path.join(repoRoot, 'server/cryptara-bootstrap-entry.ts'), 'utf8');
const docker = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const buildRouter = fs.readFileSync(path.join(repoRoot, 'scripts/cryptocrawl/build-server-overflow-authority.mjs'), 'utf8');

const requirePattern = (source, pattern, message) => {
  if (!pattern.test(source)) violations.push(message);
};
const forbidPattern = (source, pattern, message) => {
  if (pattern.test(source)) violations.push(message);
};

requirePattern(runtimeDb, /SUPABASE_DATABASE_URL_OVERFLOW/, 'runtime DB must use SUPABASE_DATABASE_URL_OVERFLOW');
requirePattern(runtimeDb, /primaryFallbackUsed:\s*false/, 'runtime DB must declare no Primary fallback');
requirePattern(runtimeDb, /export\s+const\s+pool\s*=\s*new\s+Pool/, 'ordinary Overflow runtime pool must be owned by runtime DB');
requirePattern(runtimeDb, /export\s+const\s+coordinationPool\s*=\s*new\s+Pool/, 'session-capable Overflow coordination pool must be owned by runtime DB');
forbidPattern(runtimeDb, /process\.env\.SUPABASE_DATABASE_URL(?!_OVERFLOW)/, 'runtime DB must not read Primary SUPABASE_DATABASE_URL');

requirePattern(coordination, /from\s+['"]\.\/cryptocrawl-runtime-database\.js['"]/, 'coordination must consume the Overflow runtime DB pool');
forbidPattern(
  coordination,
  /import\s+(?!type\b)[^;\n]*\sfrom\s+['"]pg['"]|require\s*\(\s*['"]pg['"]\s*\)|new\s+(?:pg\.)?Pool\s*\(/,
  'coordination must not create or runtime-import a second node-postgres pool',
);

requirePattern(schema, /003_cryptocrawler_runtime_prerequisites\.sql/, 'Overflow schema must include runtime prerequisites');
requirePattern(schema, /004_cryptocrawler_terminal_support\.sql/, 'Overflow schema must include terminal support functions without the scheduler');
requirePattern(schema, /023_cryptocrawler_hot_path_schema_authority\.sql/, 'Overflow schema must include leases, nonce and MC authorities');
requirePattern(schema, /024_cryptocrawler_funding_lifecycle\.sql/, 'Overflow schema must include funding lifecycle');
requirePattern(schema, /025_cryptocrawler_rainbow_source_ledger\.sql/, 'Overflow schema must include Rainbow source ledger');
forbidPattern(schema, /['"]016_cryptocrawler_terminal_sweeper_runtime\.sql['"]/, 'Overflow schema must not install a duplicate terminal scheduler');
requirePattern(schema, /cryptocrawler_cex_inventory_state_v1/, 'Overflow schema verification must cover authenticated inventory state');
requirePattern(schema, /cryptocrawler_profit_payout_jobs/, 'Overflow schema verification must cover payout state');
requirePattern(schema, /cryptocrawl_governance_state/, 'Overflow schema verification must cover governance state');
requirePattern(schema, /cryptocrawler_kraken_nonce_state/, 'Overflow schema verification must cover Kraken nonce state');
requirePattern(schema, /cryptocrawler_claim_resource_slot/, 'Overflow schema verification must cover lease claim authority');

requirePattern(bootstrap, /ensureCryptocrawlOverflowRuntimeSchema/, 'bootstrap must provision and verify complete Overflow authority schema');
requirePattern(bootstrap, /complete CryptoCrawler runtime schema verified on Overflow/, 'bootstrap must log complete Overflow authority readiness');

// Source-level legacy imports are inventoried rather than accepted as runtime
// authority. The production esbuild router must rewrite every reachable one and
// emit a proof artifact; this lets very large files remain byte-stable while the
// deployed bundle has zero CryptoCrawler -> Primary DB edges.
if (directDbImports.length === 0) {
  violations.push('expected at least one legacy CryptoCrawler server/db import for the production router to prove redirected');
}
requirePattern(buildRouter, /buildApi\.onResolve\(\{ filter: \/\^\\\.\//, 'production build router must intercept relative CryptoCrawler imports');
requirePattern(buildRouter, /return \{ path: overflowDb \}/, 'production build router must resolve CryptoCrawler server/db imports to the Overflow DB module');
requirePattern(buildRouter, /getCryptocrawlOverflowRuntimeSchemaSnapshot/, 'production build must inject the complete Overflow schema readiness gate');
requirePattern(buildRouter, /auxiliaryPoolUnified\s*=\s*true/, 'production build must unify the legacy auxiliary Overflow pool');
requirePattern(buildRouter, /primaryConfigDependencyRemoved\s*=\s*true/, 'production build must remove the legacy Primary configuration dependency');
requirePattern(buildRouter, /primaryFallbackUsed:\s*false/, 'production build proof must declare no Primary fallback');
requirePattern(buildRouter, /redirectedPrimaryDbImports:\s*redirected/, 'production build proof must enumerate redirected Primary DB imports');
requirePattern(buildRouter, /auxiliaryOverflowPoolUnified:\s*auxiliaryPoolUnified/, 'production build proof must record auxiliary pool unification');

requirePattern(
  docker,
  /node\s+scripts\/cryptocrawl\/build-server-overflow-authority\.mjs\s+server\/cryptara-bootstrap-entry\.ts\s+dist\/index\.js/,
  'Docker must produce the deployed server bundle through the Overflow authority build router',
);

for (const migration of [
  '007_zero_capital_execution_ledger.sql',
  '008_zero_capital_capital_provenance.sql',
  '009_railway_bootstrap_budget.sql',
  '010_cryptocrawl_governance_state.sql',
  '011_zero_capital_native_gas_funding.sql',
  '012_zero_capital_profit_recipient_proof.sql',
  '013_cryptocrawler_private_intelligence_memory.sql',
  '014_cryptocrawler_private_outbox.sql',
  '015_cryptocrawler_terminal_treasury_sweep.sql',
  '017_cryptocrawler_terminal_sweep_truth_guard.sql',
  '018_cryptocrawler_profit_split_eth_payout.sql',
  '019_cryptocrawler_dynamic_payout_strategy.sql',
  '020_cryptocrawler_trade_safe_payout_liquidity.sql',
  '021_cryptocrawler_inventory_access_hardening.sql',
  '022_cryptocrawler_payout_destination_fallback.sql',
  '023_cryptocrawler_hot_path_schema_authority.sql',
  '024_cryptocrawler_funding_lifecycle.sql',
  '025_cryptocrawler_rainbow_source_ledger.sql',
  'overflow/003_cryptocrawler_runtime_prerequisites.sql',
  'overflow/004_cryptocrawler_terminal_support.sql',
]) {
  requirePattern(docker, new RegExp(migration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Docker runtime must bundle ${migration}`);
}
forbidPattern(docker, /COPY[^\n]*016_cryptocrawler_terminal_sweeper_runtime\.sql[^\n]*dist\/migrations/, 'Docker must not bundle migration 016 as an active mirrored scheduler dependency');

if (violations.length > 0) {
  console.error('[overflow-complete-runtime-authority] FAILED');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(`[overflow-complete-runtime-authority] verified ${files.length} CryptoCrawler source files; inventoried ${directDbImports.length} legacy server/db import(s) for mandatory production redirection; node-postgres owners=${postgresPoolOwners.map(item => `${item.file}:${item.count}`).join(', ')}; complete Overflow schema gate and no duplicate terminal scheduler verified`);
