import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const repoRoot = process.cwd();
const cryptoRoot = path.resolve(repoRoot, 'server/services/cryptocrawl');
const rootDbBase = path.resolve(repoRoot, 'server/db');
const overflowDb = path.resolve(cryptoRoot, 'runtime/cryptocrawl-runtime-database.ts');
const canonicalRuntime = path.resolve(cryptoRoot, 'integration/canonical-runtime-wiring.ts');
const overflowWorker = path.resolve(cryptoRoot, 'integration/cryptara-supabase-overflow-worker.ts');

const entry = path.resolve(repoRoot, process.argv[2] || 'server/index.ts');
const outfile = path.resolve(repoRoot, process.argv[3] || 'dist/index.js');
const redirected = [];
let canonicalGateApplied = false;
let auxiliaryPoolUnified = false;
let primaryConfigDependencyRemoved = false;

function stripKnownExtension(value) {
  return value.replace(/\.(?:js|ts|mjs|cjs)$/, '');
}

function isUnder(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const overflowAuthorityPlugin = {
  name: 'cryptocrawl-overflow-runtime-authority',
  setup(buildApi) {
    // Any CryptoCrawler-originated import of the application DB module is resolved
    // to the dedicated Overflow runtime DB. LegalWhat and the rest of the app keep
    // their original Primary database wiring.
    buildApi.onResolve({ filter: /^\./ }, args => {
      if (!args.importer || !isUnder(path.resolve(args.importer), cryptoRoot)) return null;
      const resolved = stripKnownExtension(path.resolve(path.dirname(args.importer), args.path));
      if (resolved !== rootDbBase) return null;
      redirected.push({
        importer: path.relative(repoRoot, args.importer).replaceAll(path.sep, '/'),
        specifier: args.path,
      });
      return { path: overflowDb };
    });

    // Canonical runtime installation must require both transport readiness and the
    // complete migration/schema proof produced by the Overflow authority module.
    buildApi.onLoad({ filter: /canonical-runtime-wiring\.ts$/ }, async args => {
      if (path.resolve(args.path) !== canonicalRuntime) return null;
      let source = await fs.readFile(args.path, 'utf8');
      const importNeedle = "import { getCryptaraHyperBridgeBootstrapSnapshot } from './cryptara-supabase-hyper-bridge-bootstrap.js';";
      const importReplacement = `${importNeedle}\nimport { getCryptocrawlOverflowRuntimeSchemaSnapshot } from '../runtime/cryptocrawl-overflow-runtime-schema.js';`;
      const gateNeedle = "if (overflowBootstrap.state === 'ready') {";
      const gateReplacement = "if (overflowBootstrap.state === 'ready' && getCryptocrawlOverflowRuntimeSchemaSnapshot().ready) {";
      if (source.split(importNeedle).length - 1 !== 1) {
        throw new Error('[OverflowAuthorityBuild] Canonical schema snapshot import anchor is missing or duplicated');
      }
      if (source.split(gateNeedle).length - 1 !== 1) {
        throw new Error('[OverflowAuthorityBuild] Canonical Overflow install gate is missing or duplicated');
      }
      source = source.replace(importNeedle, importReplacement).replace(gateNeedle, gateReplacement);
      canonicalGateApplied = true;
      return { contents: source, loader: 'ts', resolveDir: path.dirname(args.path) };
    });

    // The legacy auxiliary cache worker used to own a second pg.Pool and inspect
    // Primary configuration. Production shares the one ordinary Overflow pool and
    // never consults Primary configuration as an Overflow readiness prerequisite.
    buildApi.onLoad({ filter: /cryptara-supabase-overflow-worker\.ts$/ }, async args => {
      if (path.resolve(args.path) !== overflowWorker) return null;
      let source = await fs.readFile(args.path, 'utf8');
      const pgImport = "import pg from 'pg';\n";
      const poolDestructure = "const { Pool } = pg;\n";
      const primaryUrlPattern = /function primaryDatabaseUrl\(\): string \{[\s\S]*?\n\}/;
      const poolPattern = /\/\/ Separate from the authoritative pool[\s\S]*?const overflowPool = isCryptaraOverflowConfigured\s*\? new Pool\(\{[\s\S]*?\}\s*as any\)\s*:\s*null;/;
      if (!source.includes(pgImport) || !source.includes(poolDestructure) || !primaryUrlPattern.test(source) || !poolPattern.test(source)) {
        throw new Error('[OverflowAuthorityBuild] Legacy auxiliary Overflow worker shape changed; refusing an unverified build');
      }
      source = source
        .replace(pgImport, "import { pool as runtimeOverflowPool } from '../runtime/cryptocrawl-runtime-database.js';\n")
        .replace(poolDestructure, '')
        .replace(primaryUrlPattern, "function primaryDatabaseUrl(): string { return ''; }")
        .replace(
          poolPattern,
          '// Auxiliary cache/proxy operations share the one ordinary Overflow runtime pool.\nconst overflowPool = isCryptaraOverflowConfigured ? runtimeOverflowPool : null;',
        );
      auxiliaryPoolUnified = true;
      primaryConfigDependencyRemoved = true;
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
  define: { 'process.env.NODE_ENV': "'production'" },
  plugins: [overflowAuthorityPlugin],
  metafile: true,
  logLevel: 'info',
});

if (!canonicalGateApplied) {
  throw new Error('[OverflowAuthorityBuild] Canonical CryptoCrawler runtime gate was not included in the server bundle');
}
if (!auxiliaryPoolUnified) {
  throw new Error('[OverflowAuthorityBuild] Legacy auxiliary Overflow pool was not unified into the runtime pool');
}
if (!primaryConfigDependencyRemoved) {
  throw new Error('[OverflowAuthorityBuild] Legacy Overflow worker still depends on Primary configuration');
}
if (redirected.length === 0) {
  throw new Error('[OverflowAuthorityBuild] No CryptoCrawler Primary DB imports were observed; routing proof is unexpectedly empty');
}

const proofPath = path.resolve(repoRoot, 'dist/cryptocrawl-overflow-authority-build-proof.json');
await fs.writeFile(proofPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  entry: path.relative(repoRoot, entry).replaceAll(path.sep, '/'),
  outfile: path.relative(repoRoot, outfile).replaceAll(path.sep, '/'),
  authority: 'SUPABASE_DATABASE_URL_OVERFLOW',
  primaryFallbackUsed: false,
  canonicalOverflowSchemaGateApplied: canonicalGateApplied,
  auxiliaryOverflowPoolUnified: auxiliaryPoolUnified,
  primaryConfigDependencyRemoved,
  redirectedPrimaryDbImports: redirected,
  outputCount: Object.keys(result.metafile?.outputs || {}).length,
}, null, 2));

console.log(`[OverflowAuthorityBuild] redirected ${redirected.length} CryptoCrawler server/db import(s) to Overflow; auxiliary pool unified; Primary config dependency removed; canonical schema gate applied; proof=${path.relative(repoRoot, proofPath)}`);
