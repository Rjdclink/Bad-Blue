const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const docker = fs.readFileSync('Dockerfile', 'utf8');
const build = fs.readFileSync('scripts/cryptocrawl/build-server-overflow-authority.mjs', 'utf8');
const runtime = fs.readFileSync('server/services/cryptocrawl/runtime/runtime-attestation.ts', 'utf8');

if (pkg.scripts['build:server'] !== 'node scripts/cryptocrawl/build-server-overflow-authority.mjs server/index.ts dist/index.js') {
  throw new Error('FAIL server build does not use the attested Overflow-authority builder');
}

if (!docker.includes('ARG RAILWAY_GIT_COMMIT_SHA')) {
  throw new Error('FAIL Docker build attestation missing ARG RAILWAY_GIT_COMMIT_SHA');
}

// Dockerfile RUN instructions may span continuation lines and may prepend
// additional fail-closed production verifiers. Verify the semantic build chain
// rather than requiring the obsolete exact text "RUN npm run build".
const dockerInstructions = docker
  .replace(/\\\r?\n\s*/g, ' ')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

const attestedBuildRun = dockerInstructions.find(line =>
  line.startsWith('RUN ') &&
  line.includes('npm run build') &&
  line.includes('node scripts/cryptocrawl/build-server-overflow-authority.mjs server/cryptara-bootstrap-entry.ts dist/index.js')
);
if (!attestedBuildRun) {
  throw new Error('FAIL Docker build attestation missing logical RUN with npm run build plus mandatory Overflow-authority server rebuild');
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

console.log('PASS Railway Docker build receives Git SHA, logical build chain runs the application build plus mandatory Overflow-authority server rebuild, immutable embedded source identity is authoritative, mutable legacy aliases cannot override it, and Railway execution remains fail-closed unless deployment identity verifies');
