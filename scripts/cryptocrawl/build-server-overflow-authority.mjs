import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const repoRoot = process.cwd();
const cryptoRoot = path.resolve(repoRoot, 'server/services/cryptocrawl');
const rootDbBase = path.resolve(repoRoot, 'server/db');
const overflowDb = path.resolve(cryptoRoot, 'runtime/cryptocrawl-runtime-database.ts');
const primaryArchiveWorker = path.resolve(cryptoRoot, 'integration/cryptara-primary-archive-worker.ts');
const canonicalRuntime = path.resolve(cryptoRoot, 'integration/canonical-runtime-wiring.ts');
const overflowWorker = path.resolve(cryptoRoot, 'integration/cryptara-supabase-overflow-worker.ts');
const terminalTreasury = path.resolve(cryptoRoot, 'runtime/terminal-treasury-lifecycle.ts');

const entry = path.resolve(repoRoot, process.argv[2] || 'server/index.ts');
const outfile = path.resolve(repoRoot, process.argv[3] || 'dist/index.js');
const redirected = [];
const primaryArchiveImports = [];
let canonicalGateApplied = false;
let auxiliaryPoolUnified = false;
let primaryConfigDependencyRemoved = false;
let overflowAdapterSemanticsCorrected = false;
let treasuryWorkerOverflowBound = false;

function normalizedSha(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : '';
}

const sourceSha = [
  process.env.RAILWAY_GIT_COMMIT_SHA,
  process.env.SOURCE_VERSION,
  process.env.GIT_COMMIT,
  process.env.COMMIT_SHA,
].map(normalizedSha).find(Boolean) || '';
const buildTimestamp = new Date().toISOString();

function stripKnownExtension(value) {
  return value.replace(/\.(?:js|ts|mjs|cjs)$/, '');
}

function isUnder(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// The canonical runtime source owns its own admission semantics. Production build
// verifies that explicit source contract instead of rewriting it, preventing source
// and deployed behavior from silently diverging.
const canonicalSource = await fs.readFile(canonicalRuntime, 'utf8');
canonicalGateApplied = canonicalSource.includes('ensureCryptocrawlOverflowRuntimeSchema')
  && canonicalSource.includes('getCryptocrawlOverflowRuntimeSchemaSnapshot')
  && canonicalSource.includes("overflowBootstrap.state === 'ready' && overflowSchema.ready")
  && canonicalSource.includes('startOverflowSchemaRepair()');
if (!canonicalGateApplied) {
  throw new Error('[OverflowAuthorityBuild] Canonical Overflow transport/schema recovery gate is not explicit in source');
}

const overflowAuthorityPlugin = {
  name: 'cryptocrawl-overflow-runtime-authority',
  setup(buildApi) {
    // All CryptoCrawler-originated imports of the application DB module resolve to
    // the dedicated Overflow runtime DB except the one explicit cold-archive
    // worker. That worker reuses the existing Primary pool through the observable
    // Bridge/gateway and is forbidden from hot/runtime authority.
    buildApi.onResolve({ filter: /^\./ }, args => {
      if (!args.importer) return null;
      const importer = path.resolve(args.importer);
      if (!isUnder(importer, cryptoRoot)) return null;
      const resolved = stripKnownExtension(path.resolve(path.dirname(args.importer), args.path));
      if (resolved !== rootDbBase) return null;
      if (importer === primaryArchiveWorker) {
        primaryArchiveImports.push({
          importer: path.relative(repoRoot, args.importer).replaceAll(path.sep, '/'),
          specifier: args.path,
        });
        return null;
      }
      redirected.push({
        importer: path.relative(repoRoot, args.importer).replaceAll(path.sep, '/'),
        specifier: args.path,
      });
      return { path: overflowDb };
    });

    // The artifact/cache adapter must already be source-unified onto the one
    // canonical CryptoCrawler Overflow runtime pool. Production verifies this
    // contract; it does not rewrite database ownership behind reviewed source.
    buildApi.onLoad({ filter: /cryptara-supabase-overflow-worker\.ts$/ }, async args => {
      if (path.resolve(args.path) !== overflowWorker) return null;
      const source = await fs.readFile(args.path, 'utf8');
      const sourceUnified = source.includes("import { pool as runtimeOverflowPool } from '../runtime/cryptocrawl-runtime-database.js';")
        && source.includes('function activeOverflowPool()')
        && !source.includes("import pg from 'pg'")
        && !/\bnew\s+(?:pg\.)?Pool\s*\(/.test(source);
      const noPrimaryDependency = !source.includes('function primaryDatabaseUrl()')
        && !/process\.env\.SUPABASE_DATABASE_URL(?!_OVERFLOW)/.test(source);
      const truthfulAuthority = source.includes("authority: 'canonical_overflow_runtime_control_plane' as const")
        && source.includes("scope: 'artifact_adapter_only' as const")
        && source.includes('overflowControlPlaneAuthority: true as const')
        && source.includes('adapterIndependentAuthority: false as const');

      if (!sourceUnified) {
        throw new Error('[OverflowAuthorityBuild] Overflow adapter must share the canonical runtime pool in source');
      }
      if (!noPrimaryDependency) {
        throw new Error('[OverflowAuthorityBuild] Overflow adapter must not depend on Primary database configuration');
      }
      if (!truthfulAuthority) {
        throw new Error('[OverflowAuthorityBuild] Overflow adapter authority semantics are incomplete');
      }

      auxiliaryPoolUnified = true;
      primaryConfigDependencyRemoved = true;
      overflowAdapterSemanticsCorrected = true;
      return null;
    });

    // Treasury state, payout jobs, retained-capital reservations and worker
    // coordination are hot CryptoCrawler state. The one terminal worker endpoint
    // and its authorization secret therefore resolve from Overflow-specific
    // configuration before they are synchronized into the Overflow Vault.
    buildApi.onLoad({ filter: /terminal-treasury-lifecycle\.ts$/ }, async args => {
      if (path.resolve(args.path) !== terminalTreasury) return null;
      let source = await fs.readFile(args.path, 'utf8');
      const urlNeedle = "{ name: 'cryptocrawler_supabase_url', value: (process.env.SUPABASE_URL || '').trim(), optional: false, description: requiredDescription },";
      const urlReplacement = "{ name: 'cryptocrawler_supabase_url', value: (process.env.SUPABASE_URL_OVERFLOW || '').trim(), optional: false, description: requiredDescription },";
      const keyNeedle = "{ name: 'cryptocrawler_supabase_service_key', value: (process.env.SUPABASE_SERVICE_KEY || '').trim(), optional: false, description: requiredDescription },";
      const keyReplacement = "{ name: 'cryptocrawler_supabase_service_key', value: (process.env.SUPABASE_SECRET_KEY_OVERFLOW || '').trim(), optional: false, description: requiredDescription },";
      if (source.split(urlNeedle).length - 1 !== 1 || source.split(keyNeedle).length - 1 !== 1) {
        throw new Error('[OverflowAuthorityBuild] Treasury worker endpoint/key anchors are missing or duplicated');
      }
      source = source.replace(urlNeedle, urlReplacement).replace(keyNeedle, keyReplacement);
      treasuryWorkerOverflowBound = true;
      return { contents: source, loader: 'ts', resolveDir: path.dirname(args.path) };
    });
  },
};

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile,
  format: 'esm',
  packages: 'external',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA': JSON.stringify(sourceSha),
    'process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
  },
  plugins: [overflowAuthorityPlugin],
  metafile: true,
  logLevel: 'info',
});

if (!canonicalGateApplied) {
  throw new Error('[OverflowAuthorityBuild] Canonical CryptoCrawler runtime gate was not included in the server bundle');
}
if (!auxiliaryPoolUnified) {
  throw new Error('[OverflowAuthorityBuild] Overflow adapter is not source-unified into the runtime pool');
}
if (!primaryConfigDependencyRemoved) {
  throw new Error('[OverflowAuthorityBuild] Legacy Overflow adapter still depends on Primary configuration');
}
if (!overflowAdapterSemanticsCorrected) {
  throw new Error('[OverflowAuthorityBuild] Legacy Overflow adapter still misstates the Overflow control-plane authority');
}
if (!treasuryWorkerOverflowBound) {
  throw new Error('[OverflowAuthorityBuild] Treasury worker endpoint/authorization is not bound to Overflow');
}
if (redirected.length === 0) {
  throw new Error('[OverflowAuthorityBuild] No hot CryptoCrawler Primary DB imports were observed; routing proof is unexpectedly empty');
}
if (primaryArchiveImports.length !== 1 || primaryArchiveImports[0]?.importer !== 'server/services/cryptocrawl/integration/cryptara-primary-archive-worker.ts') {
  throw new Error(`[OverflowAuthorityBuild] Expected exactly one explicit Primary archive DB import, observed ${JSON.stringify(primaryArchiveImports)}`);
}

const proofPath = path.resolve(repoRoot, 'dist/cryptocrawl-overflow-authority-build-proof.json');
await fs.writeFile(proofPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  entry: path.relative(repoRoot, entry).replaceAll(path.sep, '/'),
  outfile: path.relative(repoRoot, outfile).replaceAll(path.sep, '/'),
  authority: 'SUPABASE_DATABASE_URL_OVERFLOW',
  primaryFallbackUsed: false,
  sourceSha: sourceSha || null,
  buildTimestamp,
  sourceAttestation: sourceSha ? 'railway_or_ci_git_metadata' : 'local_build_without_git_metadata',
  canonicalOverflowSchemaGateApplied: canonicalGateApplied,
  canonicalOverflowSchemaGateSourceOwned: true,
  canonicalOverflowSchemaBuildMutation: false,
  auxiliaryOverflowPoolUnified: auxiliaryPoolUnified,
  primaryConfigDependencyRemoved,
  overflowAdapterSemanticsCorrected,
  treasuryWorkerOverflowBound,
  treasuryWorkerUrlVariable: 'SUPABASE_URL_OVERFLOW',
  treasuryWorkerSecretVariable: 'SUPABASE_SECRET_KEY_OVERFLOW',
  redirectedPrimaryDbImports: redirected,
  primaryArchiveDbImports: primaryArchiveImports,
  primaryArchiveRole: 'cold_storage_only',
  outputCount: Object.keys(result.metafile?.outputs || {}).length,
}, null, 2));

console.log(`[OverflowAuthorityBuild] redirected ${redirected.length} hot CryptoCrawler server/db import(s) to Overflow; explicit Primary archive imports=${primaryArchiveImports.length}; adapter source-unified to runtime pool; adapter semantics verified; treasury worker bound to Overflow; Primary config dependency absent; canonical schema gate source-owned; sourceSha=${sourceSha || 'unavailable'}; buildTimestamp=${buildTimestamp}; proof=${path.relative(repoRoot, proofPath)}`);