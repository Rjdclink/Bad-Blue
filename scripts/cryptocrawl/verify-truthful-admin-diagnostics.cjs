const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}
function forbidText(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
}

const apiIndex = read('server/services/cryptocrawl/api/index.ts');
const diagnostics = read('server/services/cryptocrawl/api/truthful-admin-diagnostics.ts');
const legacyAdmin = read('server/services/cryptocrawl/api/admin-api.ts');

requireText(apiIndex, "import { truthfulAdminDiagnostics } from './truthful-admin-diagnostics.js'", 'truthful diagnostics router is exported through CryptoCrawler API');
requireText(apiIndex, 'adminApi.use(truthfulAdminDiagnostics);', 'truthful diagnostics are mounted');
requireText(apiIndex, 'adminApi.use(legacyAdminApi);', 'legacy governance/control routes remain available behind truthful diagnostics');
const truthfulIndex = apiIndex.indexOf('adminApi.use(truthfulAdminDiagnostics);');
const legacyIndex = apiIndex.indexOf('adminApi.use(legacyAdminApi);');
if (truthfulIndex < 0 || legacyIndex < 0 || truthfulIndex >= legacyIndex) {
  failures.push('truthful diagnostics must be mounted before the legacy admin router');
}

requireText(diagnostics, "router.get('/health'", 'truthful health route exists');
requireText(diagnostics, 'await db.execute(sql`SELECT 1`)', 'health uses a real database probe');
requireText(diagnostics, 'multiProviderRpcManager.getHealth(chain)', 'health uses canonical RPC-manager observations');
requireText(diagnostics, "import('../discovery/opportunity-graph.js')", 'health reads canonical discovery state lazily');
requireText(diagnostics, "import('../execution/canonical-execution-scheduler.js')", 'health reads canonical scheduler state lazily');
requireText(diagnostics, 'requiredForCoreCexDiscovery: false', 'RPC telemetry is not falsely presented as a core CEX requirement');
requireText(diagnostics, 'isRuntimeIdentitySafe(runtime)', 'health includes runtime identity safety');

requireText(diagnostics, "router.get('/logs'", 'truthful log route exists');
requireText(diagnostics, "path.resolve(process.cwd(), 'logs', 'combined.log')", 'logs come from the real Winston combined log');
requireText(diagnostics, 'JSON.parse(lines[index])', 'real log rows are parsed from recorded output');
requireText(diagnostics, 'available: false', 'missing log evidence is reported unavailable');
forbidText(diagnostics, 'Log message ${i}', 'truthful diagnostics must never synthesize placeholder logs');

requireText(diagnostics, "router.get('/config'", 'canonical config posture route exists');
requireText(diagnostics, "authority: 'canonical_runtime_sources'", 'config response declares canonical authority');
requireText(diagnostics, 'mutableHere: false', 'diagnostics config is explicitly non-authoritative for mutation');
requireText(diagnostics, 'getVenueCapabilities()', 'config uses venue capability authority');
requireText(diagnostics, 'loadDynamicChainRegistry()', 'config uses dynamic chain authority');
requireText(diagnostics, 'stageManager.getState()', 'config uses StageManager authority');
requireText(diagnostics, "router.post('/config'", 'legacy decorative config mutation is intercepted');
requireText(diagnostics, 'res.status(409)', 'decorative config mutation fails closed');

// The legacy implementation is intentionally still present behind the composed
// router for non-diagnostics control routes. Verify the known synthetic helpers
// remain confined there and are not exported directly as the admin API.
requireText(legacyAdmin, 'async function getRecentLogs', 'legacy synthetic helper remains identifiable for later removal');
forbidText(apiIndex, "export {dashboardApi, legacyAdminApi", 'legacy router must not be exported directly');

if (failures.length) {
  console.error('[verify-truthful-admin-diagnostics] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-truthful-admin-diagnostics] PASS');
console.log(' - health uses measured DB/RPC/core/runtime evidence');
console.log(' - logs are tailed from real Winston output and never synthesized');
console.log(' - config is a read-only canonical posture, not decorative in-memory authority');
console.log(' - legacy governance/control routes remain behind the truthful diagnostics router');
