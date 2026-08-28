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
  'CryptoCrawler clean-house authority boundaries',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-clean-house.cjs')],
);

run(
  'CryptoCrawler clean-house authority extensions',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-clean-house-authority-extensions.cjs')],
);

run(
  'CryptoCrawler solution implementation invariants',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-solution-implementation.cjs')],
);

run(
  'CryptoCrawler no-regression invariants v2',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-no-regression-opportunity-pipeline-v2.cjs')],
);

run(
  'CryptoCrawler core topology lifecycle wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-core-topology-wiring.cjs')],
);

run(
  'CryptoCrawler competition evidence wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-competition-evidence-wiring.cjs')],
);

run(
  'CryptoCrawler expanded profit blocker wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-profit-blocker-wiring.cjs')],
);

run(
  'CryptoCrawler Coinbase Advanced Trade integration wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-coinbase-integration-wiring.cjs')],
);

run(
  'CryptoCrawler truthful admin diagnostics wiring',
  process.execPath,
  [path.join(root, 'scripts', 'cryptocrawl', 'verify-truthful-admin-diagnostics.cjs')],
);

console.log('[deployment-preflight] PASS — clean-house boundaries/extensions, solution implementation invariants, current CryptoCrawler invariants, topology lifecycle, competition evidence, profit blockers, Coinbase Advanced Trade boundaries, and truthful diagnostics are clean; normal production build continues with Vite/esbuild');
