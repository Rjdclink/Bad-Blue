const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');
const src = fs.readFileSync('client/src/pages/cryptocrawler-dashboard.tsx', 'utf8');
const code = esbuild.transformSync(src, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
let slot = 0, effects = [], cleanups = [], state = [], backend = 'OFF', requests = [], timers = 0;
const react = {
  useState(initial) { const i = slot++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
  useRef(initial) { const i = slot++; return state[i] ||= { current: initial }; },
  useCallback(fn) { const i = slot++; return state[i] ||= fn; },
  useEffect(fn) { slot++; effects.push(fn); },
};
const jsx = (type, props) => ({ type, props });
const snapshot = () => ({ running: backend === 'ON', lifecycle: backend === 'OFF' ? 'STOPPED' : backend === 'ON' ? 'RUNNING' : 'INITIALIZING', control: { manualPowerPhase: backend }, cryptoCrawl: {}, uptime: 0, startedAt: null });
const apiRequest = async (url) => {
  requests.push(url);
  if (url.endsWith('/start')) { backend = 'STARTING'; throw new Error('simulated lost HTTP response'); }
  if (url.endsWith('/stop')) { backend = 'OFF'; return { json: async () => ({ success: true, uptime: 0 }) }; }
  throw Error(`Unexpected command ${url}`);
};
const fetch = async url => {
  requests.push(url);
  if (url.endsWith('/status')) return { ok: true, json: async () => snapshot() };
  if (url.includes('/logs')) return { ok: true, json: async () => ({ available: true, logs: [{ timestamp: Date.now(), level: 'info', component: 'TestRuntime', message: 'Real fixture event' }] }) };
  return { ok: true, json: async () => ({}) };
};
const mocks = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx },
  wouter: { useLocation: () => ['/cryptocrawler-dashboard', () => {}] },
  '@/hooks/useAuth': { useAuth: () => ({ isAuthenticated: true, isLoading: false }) },
  '@/hooks/use-toast': { useToast: () => ({ toast() {} }) },
  '@/hooks/useWallet': { useWallet: () => ({}), SUPPORTED_CHAINS: {} },
  '@/lib/queryClient': { apiRequest, getInternalAuthHeaders: () => ({}) },
};
const mod = { exports: {} };
Function('require', 'module', 'exports', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', code)(name => mocks[name] || new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) }), mod, mod.exports, fetch, () => ++timers, () => {}, () => ++timers, () => {});
function render() { cleanups.forEach(fn => fn?.()); cleanups = []; slot = 0; effects = []; return mod.exports.default(); }
async function runEffects() { cleanups = effects.map(fn => fn()); await new Promise(resolve => setImmediate(resolve)); }
function find(node, predicate) { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; } }
function text(node) { if (typeof node === 'string') return node; if (!node || typeof node !== 'object') return ''; return [node.props?.children].flat(Infinity).map(text).join(''); }
(async () => {
  let tree = render(); await runEffects();
  tree = render(); requests = []; timers = 0; await runEffects();
  assert.equal(requests.filter(x => x.includes('/logs')).length, 0);
  assert.equal(timers, 0);
  assert.ok(find(tree, n => n.props?.['aria-label'] === 'Live system activity').props.className.includes('grid-cols-2'));
  const start = find(tree, n => n.type === 'Button' && text(n) === 'Start System');
  await start.props.onClick();
  tree = render(); await runEffects(); tree = render();
  assert.ok(text(tree).includes('STARTING'));
  const stop = find(tree, n => n.type === 'Button' && text(n) === 'Stop System');
  assert.equal(stop.props.disabled, false);
  assert.ok(requests.some(x => x.includes('/logs')));
  await stop.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = render(); requests = []; timers = 0; await runEffects();
  assert.equal(timers, 0);
  assert.equal(requests.filter(x => x.includes('/logs')).length, 0);
  assert.ok(!text(tree).includes('🟢 ACTIVE'));
  console.log('PASS OFF idle, lost-start response reconciliation, live console, reachable Stop, stopped polling, side-by-side layout');
})().catch(error => { console.error(error); process.exitCode = 1; });
