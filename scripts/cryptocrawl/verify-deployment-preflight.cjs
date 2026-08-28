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

run('CryptoCrawler clean-house authority boundaries', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-clean-house.cjs')]);
run('CryptoCrawler clean-house authority extensions', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-clean-house-authority-extensions.cjs')]);
run('CryptoCrawler solution implementation invariants', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-solution-implementation.cjs')]);
run('CryptoCrawler canonical CEX L2 integrity', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-s72-l2-integrity.cjs')]);
run('CryptoCrawler S-65 through S-94 semantic completion', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-s65-s94-completion.cjs')]);
run('CryptoCrawler 247-issue source reconciliation', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-source-completion-reconciliation.cjs')]);
run('CryptoCrawler S-80 measured latency wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-s80-latency-wiring.cjs')]);
run('CryptoCrawler S-94 performance truth contract', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-performance-truth-contract.cjs')]);
run('CryptoCrawler no-regression invariants v2', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-no-regression-opportunity-pipeline-v2.cjs')]);
run('CryptoCrawler core topology lifecycle wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-core-topology-wiring.cjs')]);
run('CryptoCrawler competition evidence wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-competition-evidence-wiring.cjs')]);
run('CryptoCrawler expanded profit blocker wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-profit-blocker-wiring.cjs')]);
run('CryptoCrawler Coinbase Advanced Trade integration wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-coinbase-integration-wiring.cjs')]);
run('CryptoCrawler truthful admin diagnostics wiring', process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-truthful-admin-diagnostics.cjs')]);

console.log('[deployment-preflight] PASS — S-01..S-94, all 247 source issues, clean-house/no-regression boundaries, measured latency/performance truth, topology, competition, profit blockers, Coinbase Advanced Trade, and diagnostics are source-complete; Railway deployment remains a separate gated stage');
