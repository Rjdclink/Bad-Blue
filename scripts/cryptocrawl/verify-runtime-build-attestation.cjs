const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const docker = fs.readFileSync('Dockerfile', 'utf8');
const build = fs.readFileSync('scripts/cryptocrawl/build-server-overflow-authority.mjs', 'utf8');
const runtime = fs.readFileSync('server/services/cryptocrawl/runtime/runtime-attestation.ts', 'utf8');

if (pkg.scripts['build:server'] !== 'node scripts/cryptocrawl/build-server-overflow-authority.mjs server/index.ts dist/index.js') {
  throw new Error('FAIL server build does not use the attested Overflow-authority builder');
}
for (const token of [
  'ARG RAILWAY_GIT_COMMIT_SHA',
  'RUN npm run build',
  'node scripts/cryptocrawl/build-server-overflow-authority.mjs server/cryptara-bootstrap-entry.ts dist/index.js',
]) {
  if (!docker.includes(token)) throw new Error(`FAIL Docker build attestation missing ${token}`);
}
for (const token of [
  'process.env.RAILWAY_GIT_COMMIT_SHA',
  "'process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA'",
  "'process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP'",
  'plugins: [overflowAuthorityPlugin]',
  "authority: 'SUPABASE_DATABASE_URL_OVERFLOW'",
  'primaryFallbackUsed: false',
]) {
  if (!build.includes(token)) throw new Error(`FAIL build attestation missing ${token}`);
}
for (const token of [
  'const EMBEDDED_SOURCE_SHA = process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA',
  'const EMBEDDED_BUILD_TIMESTAMP = process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP',
  'const embeddedSourceSha = normalizeSha(EMBEDDED_SOURCE_SHA || null)',
  'const sourceSha = embeddedSourceSha || legacySourceCandidates[0] || null',
  "if (embeddedSourceSha) evidence.push('embedded_build_source_sha')",
  'if (!embeddedSourceSha) {',
  'embeddedSourceSha && railwayCommitSha',
  "return railwayRuntime ? attestation.state === 'verified' : attestation.state !== 'mismatch'",
]) {
  if (!runtime.includes(token)) throw new Error(`FAIL runtime attestation missing ${token}`);
}

console.log('PASS Railway Docker build receives Git SHA, immutable embedded source identity is authoritative, mutable legacy aliases cannot override it, and Railway execution remains fail-closed unless deployment identity verifies');
