'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[free-tier-startup] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[free-tier-startup] forbidden regression: ${description}`);
};

const entry = read('server/cryptara-bootstrap-entry.ts');
const dockerfile = read('Dockerfile');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');

// Production must contract the pool and install Cryptara before the normal server
// entry is evaluated. Neither step may itself issue a database/provider request.
requirePattern(
  entry,
  /import\('\.\/migrations\/reconcileAppSchema\.js'\)[\s\S]{0,500}installCryptaraSuperWorkerAdmission[\s\S]{0,300}import\('\.\/index\.js'\)/,
  'rollout contraction and Cryptara admission must precede normal server evaluation',
);
requirePattern(migrations, /const\s+rolloutMax\s*=\s*1\s*;/, 'Railway startup remains one ordinary DB client');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission[\s\S]{0,420}installCryptaraSupabaseAdmissionWorker\(\)/, 'Super Worker delegates to the existing admission governor');
forbidPattern(entry, /pool\.query|db\.execute|fetch\s*\(|axios|https?\.request/, 'bootstrap wrapper performs origin work before admission is installed');

// Railway's final dist/index.js must be the wrapper-bundled entry and must still
// pass the established final build verifier.
requirePattern(dockerfile, /npm run build[\s\S]{0,600}npx esbuild server\/cryptara-bootstrap-entry\.ts[\s\S]{0,600}--outfile=dist\/index\.js[\s\S]{0,600}node scripts\/verify-build\.cjs/, 'Docker build emits and verifies the Cryptara-first production entry');

console.log('[free-tier-startup] PASS: one-client rollout guard and Cryptara admission are active before the first application DB request');
