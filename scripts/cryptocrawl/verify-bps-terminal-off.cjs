const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const source = fs.readFileSync('client/src/components/bps-activity-terminal.tsx', 'utf8');
const code = esbuild.transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
async function exercise(running, responseRunning) {
  const effects = [];
  let calls = 0, timers = 0;
  const mod = { exports: {} };
  const react = { useEffect: fn => effects.push(fn), useState: initial => [initial, () => {}], useRef: () => ({ current: null }) };
  Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'clearTimeout', code)(name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
    if (name === '@/lib/queryClient') return { getInternalAuthHeaders: () => ({}) };
    throw new Error(name);
  }, mod, mod.exports, async () => {
    calls++;
    return { ok: true, json: async () => ({ rows: [], capacity: 300, running: responseRunning }) };
  }, () => ++timers, () => {});
  mod.exports.default({ running });
  const cleanups = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  cleanups.forEach(fn => fn?.());
  return { calls, timers };
}
(async () => {
  assert.deepEqual(await exercise(false, false), { calls: 0, timers: 0 });
  assert.deepEqual(await exercise(true, false), { calls: 1, timers: 0 });
  assert.deepEqual(await exercise(true, true), { calls: 1, timers: 1 });
  for (const name of ['cryptocrawler-v2', 'cryptocrawler-dashboard']) {
    const page = fs.readFileSync(`client/src/pages/${name}.tsx`, 'utf8');
    esbuild.transformSync(page, { loader: 'tsx' });
    assert.ok(page.includes('if (!isSystemRunning || stoppingSystem) return;'));
    assert.ok(page.includes('<BpsActivityTerminal running={isSystemRunning && !stoppingSystem} />'));
  }
  console.log('PASS off terminal makes zero requests/timers, server OFF stops polling, dashboard polling is gated');
})().catch(error => { console.error(error); process.exitCode = 1; });
