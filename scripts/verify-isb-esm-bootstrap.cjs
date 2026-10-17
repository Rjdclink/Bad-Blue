'use strict';
// Verify production's ESM bundling can start the CommonJS ISB adapter.
// This specifically catches esbuild's unsupported dynamic node:crypto require.
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const {mkdtempSync, rmSync, readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {spawnSync} = require('node:child_process');

const repoRoot = resolve(__dirname, '..');
const serverSource = readFileSync(join(repoRoot, 'server/index.ts'), 'utf8');
assert.match(serverSource, /cryptoProvider:\s*await import\(['"]node:crypto['"]\)/);
const scratch = mkdtempSync(join(tmpdir(), 'isb-esm-'));
try {
  buildSync({
    entryPoints: [join(repoRoot, 'isb/embedded.cjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(scratch, 'isb.mjs'),
    logLevel: 'silent',
  });
  const smoke = [
    "import {createHash,randomBytes} from 'node:crypto';",
    "import mod from './isb.mjs';",
    "const createEmbeddedISB = mod.createEmbeddedISB;",
    "if (typeof createEmbeddedISB !== 'function') throw Error('ISB factory missing');",
    "const running = createEmbeddedISB({cryptoProvider:{createHash,randomBytes}});",
    "const state = running.snapshot();",
    "if (state.mode !== 'passive' || state.enforcement !== 'none' || state.bubbles.total !== 128) throw Error('ISB startup invariant failed');",
    "running.stop();",
    "console.log('ISB_ESM_STARTUP_PASS');",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module','-e',smoke], {
    cwd:scratch, encoding:'utf8', timeout:10_000, maxBuffer:256 * 1024,
  });
  assert.equal(result.status, 0, 'ISB ESM bundle startup failed: ' + (result.stderr || '').slice(0, 450));
  assert.match(result.stdout, /ISB_ESM_STARTUP_PASS/);
  console.log('PASS embedded ISB initializes inside a native ESM server bundle');
} finally {
  rmSync(scratch, {recursive:true,force:true});
}
