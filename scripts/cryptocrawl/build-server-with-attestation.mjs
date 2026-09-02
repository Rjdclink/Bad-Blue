import { build } from 'esbuild';

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

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  format: 'esm',
  packages: 'external',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA': JSON.stringify(sourceSha),
    'process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
  },
});

console.log('[CryptoCrawlerBuild] server bundle attestation embedded', {
  sourceSha: sourceSha || null,
  buildTimestamp,
  source: sourceSha ? 'railway_or_ci_git_metadata' : 'local_build_without_git_metadata',
});
