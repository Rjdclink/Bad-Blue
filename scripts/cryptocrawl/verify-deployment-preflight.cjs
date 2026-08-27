const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const safeEnv = {
  ...process.env,
  NO_EXECUTION: 'true',
  NO_INTERVALS: 'true',
  CRYPTARA_MODE: 'SILENT_WATCHER_ONLY',
};

function run(label, executable, args) {
  console.log(`[deployment-preflight] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: root,
    env: safeEnv,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[deployment-preflight] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`[deployment-preflight] ${label} terminated by signal ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[deployment-preflight] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

run(
  'CryptoCrawler no-regression invariants',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-no-regression-opportunity-pipeline.cjs')],
);

run(
  'CryptoCrawler competition evidence wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-competition-evidence-wiring.cjs')],
);

console.log('[deployment-preflight] PASS — CryptoCrawler invariants and competition-evidence wiring are clean; normal production build continues with Vite/esbuild');
