const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const build = fs.readFileSync('scripts/cryptocrawl/build-server-with-attestation.mjs', 'utf8');
const runtime = fs.readFileSync('server/services/cryptocrawl/runtime/runtime-attestation.ts', 'utf8');

if (pkg.scripts['build:server'] !== 'node scripts/cryptocrawl/build-server-with-attestation.mjs') {
  throw new Error('FAIL server build does not use attested bundle builder');
}
for (const token of [
  'process.env.RAILWAY_GIT_COMMIT_SHA',
  "'process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA'",
  "'process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP'",
]) {
  if (!build.includes(token)) throw new Error(`FAIL build attestation missing ${token}`);
}
for (const token of [
  'const EMBEDDED_SOURCE_SHA = process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA',
  'const EMBEDDED_BUILD_TIMESTAMP = process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP',
  "'embedded_build_source_sha'",
  "return railwayRuntime ? attestation.state === 'verified' : attestation.state !== 'mismatch'",
]) {
  if (!runtime.includes(token)) throw new Error(`FAIL runtime attestation missing ${token}`);
}

console.log('PASS immutable CryptoCrawler build source/timestamp attestation');
