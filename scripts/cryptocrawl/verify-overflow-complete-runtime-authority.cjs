'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.cwd();
const cryptoRoot = path.join(repoRoot, 'server/services/cryptocrawl');
const allowedPoolOwner = path.normalize('server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts');
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
for (const file of files) {
  const rel = relative(file);
  const source = fs.readFileSync(file, 'utf8');

  for (const specifier of importSpecifiers(source)) {
    if (resolvesToRootDb(file, specifier)) {
      violations.push(`${rel}: direct import of Primary application server/db is forbidden (${specifier})`);
    }
  }

  const poolCreations = [...source.matchAll(/\bnew\s+(?:pg\.)?Pool\s*\(/g)].length;
  if (poolCreations > 0 && path.normalize(rel) !== allowedPoolOwner) {
    violations.push(`${rel}: creates ${poolCreations} Postgres Pool instance(s); CryptoCrawler has one Overflow pool owner only`);
  }

  if (rel !== 'server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts') {
    if (/CRYPTOCRAWL_COORDINATION_DATABASE_URL/.test(source)) {
      violations.push(`${rel}: alternate coordination database authority is forbidden`);
    }
    if (/\bSUPABASE_DATABASE_URL\b/.test(source) && !/SUPABASE_DATABASE_URL_OVERFLOW/.test(source)) {
      violations.push(`${rel}: Primary SUPABASE_DATABASE_URL authority is forbidden in CryptoCrawler runtime`);
    }
  }
}

const runtimeDb = fs.readFileSync(path.join(cryptoRoot, 'runtime/cryptocrawl-runtime-database.ts'), 'utf8');
const schema = fs.readFileSync(path.join(cryptoRoot, 'runtime/cryptocrawl-overflow-runtime-schema.ts'), 'utf8');
const coordination = fs.readFileSync(path.join(cryptoRoot, 'runtime/database-coordination.ts'), 'utf8');
const bootstrap = fs.readFileSync(path.join(repoRoot, 'server/cryptara-bootstrap-entry.ts'), 'utf8');
const canonical = fs.readFileSync(path.join(cryptoRoot, 'integration/canonical-runtime-wiring.ts'), 'utf8');
const docker = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');

const requirePattern = (source, pattern, message) => {
  if (!pattern.test(source)) violations.push(message);
};
const forbidPattern = (source, pattern, message) => {
  if (pattern.test(source)) violations.push(message);
};

requirePattern(runtimeDb, /SUPABASE_DATABASE_URL_OVERFLOW/, 'runtime DB must use SUPABASE_DATABASE_URL_OVERFLOW');
requirePattern(runtimeDb, /primaryFallbackUsed:\s*false/, 'runtime DB must declare no Primary fallback');
requirePattern(runtimeDb, /export\s+const\s+coordinationPool\s*=\s*new\s+Pool/, 'single Overflow coordination pool must be owned by runtime DB');
forbidPattern(runtimeDb, /SUPABASE_DATABASE_URL(?!_OVERFLOW)/, 'runtime DB must not read Primary SUPABASE_DATABASE_URL');

requirePattern(coordination, /from\s+['"]\.\/cryptocrawl-runtime-database\.js['"]/, 'coordination must consume the single Overflow runtime DB pool');
forbidPattern(coordination, /new\s+(?:pg\.)?Pool\s*\(/, 'coordination must not create a second pool');

requirePattern(schema, /003_cryptocrawler_runtime_prerequisites\.sql/, 'Overflow schema must include runtime prerequisites');
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

requirePattern(canonical, /getCryptocrawlOverflowRuntimeSchemaSnapshot/, 'canonical runtime must consume Overflow schema readiness');
requirePattern(canonical, /overflowRuntimeSchema[^\n]*ready|overflowSchema[^\n]*ready|\.ready/, 'canonical runtime must require Overflow authority readiness before install');

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
]) {
  requirePattern(docker, new RegExp(migration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Docker runtime must bundle ${migration}`);
}
forbidPattern(docker, /COPY[^\n]*016_cryptocrawler_terminal_sweeper_runtime\.sql[^\n]*dist\/migrations/, 'Docker must not bundle Overflow runtime 016 as an active mirrored scheduler dependency');

if (violations.length > 0) {
  console.error('[overflow-complete-runtime-authority] FAILED');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(`[overflow-complete-runtime-authority] verified ${files.length} CryptoCrawler source files: one Overflow runtime DB authority, one coordination pool, no direct Primary DB imports, complete schema gate, and no duplicate terminal scheduler`);
