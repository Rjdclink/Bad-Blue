import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const repoRoot = process.cwd();
const cryptoRoot = path.resolve(repoRoot, 'server/services/cryptocrawl');
const rootDbBase = path.resolve(repoRoot, 'server/db');
const overflowDb = path.resolve(cryptoRoot, 'runtime/cryptocrawl-runtime-database.ts');
const canonicalRuntime = path.resolve(cryptoRoot, 'integration/canonical-runtime-wiring.ts');

const entry = path.resolve(repoRoot, process.argv[2] || 'server/index.ts');
const outfile = path.resolve(repoRoot, process.argv[3] || 'dist/index.js');
const redirected = [];
let canonicalGateApplied = false;

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

    buildApi.onLoad({ filter: /canonical-runtime-wiring\.ts$/ }, async args => {
      if (path.resolve(args.path) !== canonicalRuntime) return null;
      const original = await fs.readFile(args.path, 'utf8');
      const needle = "if (overflowBootstrap.state === 'ready') {";
      const replacement = "if (overflowBootstrap.state === 'ready' && process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY === 'true') {";
      const occurrences = original.split(needle).length - 1;
      if (occurrences !== 1) {
        throw new Error(`[OverflowAuthorityBuild] Expected exactly one canonical Overflow install gate, found ${occurrences}`);
      }
      canonicalGateApplied = true;
      return {
        contents: original.replace(needle, replacement),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      };
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
  redirectedPrimaryDbImports: redirected,
  outputCount: Object.keys(result.metafile?.outputs || {}).length,
}, null, 2));

console.log(`[OverflowAuthorityBuild] redirected ${redirected.length} CryptoCrawler server/db import(s) to Overflow; canonical schema gate applied; proof=${path.relative(repoRoot, proofPath)}`);
