const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'cryptocrawl', 'verify-clean-house.cjs')], {
  cwd: root,
  env: { ...process.env, NO_EXECUTION: 'true', NO_INTERVALS: 'true', CRYPTARA_MODE: 'SILENT_WATCHER_ONLY' },
  stdio: 'inherit',
});
if (result.error || result.signal || result.status !== 0) process.exit(result.status || 1);
console.log('[deployment-preflight] DIAGNOSTIC PASS — clean-house only');
