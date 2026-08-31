'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const checks = [
  'verify-runtime-safety-invariants.cjs',
  'verify-profitability-recovery-coordinator.cjs',
  'verify-substantial-profitability-batch9.cjs',
  'verify-cryptara-sovereign-cortex.cjs',
  'verify-compute-antenna-monte-carlo-batch11.cjs',
  'verify-remaining-seventeen-batch12.cjs',
  'verify-300-profitability-live-execution-controls.cjs',
  'verify-aave-balancer-provider-mesh.cjs',
  'verify-cex-websocket-rpi-modernization.cjs',
  'verify-resource-bps-coordination.cjs',
  'verify-migration-authority-runtime.cjs',
  'verify-product-discovery-coverage.cjs',
  'verify-dex-atomic-profit-path.cjs',
  'verify-aave-liquidation-profit-integrity.cjs',
  'verify-cross-chain-funding-route-truth.cjs',
  'verify-topology-execution-integrity.cjs',
  'verify-zero-capital-bps-propagation.cjs',
  'verify-bootstrap-execution-history.cjs',
  'verify-unified-multileg-adaptive-engine.cjs',
];

const results = [];
for (const file of checks) {
  const script = path.join(root, 'scripts', 'cryptocrawl', file);
  const run = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
  });
  results.push({
    file,
    passed: run.status === 0,
    status: run.status,
    signal: run.signal || null,
    stdout: String(run.stdout || '').trim().slice(-8000),
    stderr: String(run.stderr || '').trim().slice(-12000),
    spawnError: run.error ? String(run.error.message || run.error) : null,
  });
}

const report = {
  diagnosticOnly: true,
  mergeAllowed: false,
  generatedAt: new Date().toISOString(),
  passed: results.filter(item => item.passed).length,
  failed: results.filter(item => !item.passed).length,
  results,
};
fs.writeFileSync(path.join(root, 'diag-prebuild-report.json'), JSON.stringify(report, null, 2));
console.log(`[diag-prebuild-report] completed ${report.passed}/${results.length}; failures=${report.failed}`);
// Diagnostic image must build so the report can be retrieved from its temporary
// endpoint. The real PR continues to fail closed through the unmodified prebuild.
process.exit(0);
