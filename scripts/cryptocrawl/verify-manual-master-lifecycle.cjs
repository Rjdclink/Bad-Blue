const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function has(source, pattern, message) {
  assert(pattern.test(source), message);
}
function lacks(source, pattern, message) {
  assert(!pattern.test(source), message);
}

const boot = read('server/index.ts');
const admin = read('server/services/cryptocrawl/api/admin-api.ts');
const dashboard = read('client/src/pages/cryptocrawler-dashboard.tsx');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const stageProgression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const canonicalDashboard = read('server/services/cryptocrawl/api/canonical-dashboard-api.ts');

lacks(boot, /automaticCryptoCrawlerRuntimeRequired/, 'server boot must not own CryptoCrawler automatic resume');
lacks(boot, /startCryptoCrawlerRuntime/, 'server boot must never invoke the CryptoCrawler start authority');
has(boot, /runtime remains STOPPED pending explicit master start/, 'server boot must explicitly preserve stopped-by-default intent');

has(admin, /lifecycle:\s*'STOPPED'/, 'canonical lifecycle must initialize STOPPED');
has(admin, /running:\s*false/, 'canonical lifecycle must initialize not running');
has(admin, /operatorStartRequired:\s*true/, 'status must expose operator-only start truth');
has(admin, /automaticStartEnabled:\s*false/, 'status must expose that automatic start is disabled');
lacks(admin, /startAutomaticCryptoCrawlerRuntime/, 'governance events must not own runtime activation');
has(admin, /serializeLifecycleCommand/, 'master lifecycle commands must be serialized');
has(admin, /router\.post\('\/start'[\s\S]{0,220}serializeLifecycleCommand/, 'start endpoint must serialize lifecycle transitions');
has(admin, /router\.post\('\/stop'[\s\S]{0,700}serializeLifecycleCommand/, 'stop endpoint must serialize lifecycle transitions');
has(admin, /router\.post\('\/start'/, 'canonical authenticated start endpoint must remain');
has(admin, /router\.post\('\/stop'/, 'canonical authenticated stop endpoint must remain');
has(admin, /pipeline\.stop\(\)/, 'stop authority must stop the canonical pipeline');
has(admin, /zeroCapitalEngine\.stop\(\)/, 'stop authority must stop zero-capital runtime context');
has(admin, /autonomousFaucet\.stop\(\)/, 'stop authority must stop the autonomous faucet');
has(admin, /cryptoCrawlState\.disable\(\)/, 'stop authority must stop crawler dependencies');
has(admin, /activateCanonicalCryptoCrawlerRuntimeWiring\(\)/, 'master start must explicitly activate canonical runtime wiring');
has(admin, /deactivateCanonicalCryptoCrawlerRuntimeWiring\(\)/, 'master stop must explicitly deactivate canonical runtime wiring');
has(admin, /void\s+ensureTelemetryBootstrap\(\)/, 'master start must explicitly activate telemetry');

has(canonicalRuntime, /let\s+runtimeActivationAllowed\s*=\s*false/, 'canonical runtime must default to activation denied');
has(canonicalRuntime, /if\s*\(!runtimeActivationAllowed\s*\|\|\s*installed\)\s*return/, 'canonical runtime ensure entrypoint must fail closed while master power is off');
has(canonicalRuntime, /export function activateCanonicalCryptoCrawlerRuntimeWiring/, 'canonical runtime must expose explicit activation');
has(canonicalRuntime, /export async function deactivateCanonicalCryptoCrawlerRuntimeWiring/, 'canonical runtime must expose explicit deactivation');
has(canonicalRuntime, /stopCanonicalZeroCapitalDiscovery\(\)/, 'master deactivation must stop zero-capital discovery');
has(canonicalRuntime, /multiTopologyDiscoveryController\.stop\(\)/, 'master deactivation must stop multi-topology discovery');
has(canonicalRuntime, /ghostWalletUltraWorker\.stop\(\)/, 'master deactivation must stop Ghost worker activity');
has(canonicalRuntime, /providerMeshPendingStream\.stop\(\)/, 'master deactivation must stop pending-provider streams');
has(canonicalRuntime, /stopPredictionMarketDiscoveryWiring\(\)/, 'master deactivation must stop prediction-market cadence');
has(canonicalRuntime, /stopOrderBookEvolutionWiring\(\)/, 'master deactivation must stop order-book evolution cadence');
has(canonicalRuntime, /stopCexFourModeObservabilityWiring\(\)/, 'master deactivation must stop CEX mode cadence');
has(canonicalRuntime, /stopCexInventoryReadinessWiring\(\)/, 'master deactivation must stop inventory hydration cadence');
has(canonicalRuntime, /stopComputationalReactorWiring\(\)/, 'master deactivation must stop CryptoCrawler reactor calibration');
has(canonicalRuntime, /stopBpsCompressionMesh\(\)/, 'master deactivation must stop BPS compression cadence');
has(canonicalRuntime, /stopEconomicTransformationWiring\(\)/, 'master deactivation must stop economic transformation cadence');
has(canonicalRuntime, /stopCryptoRuntimeObservability\(\)/, 'master deactivation must stop runtime heartbeat');

lacks(stageProgression, /ensureTelemetryBootstrap/, 'governance module loading must never start telemetry');
lacks(telemetry, /ensureCryptoCrawlerCoreRuntime/, 'telemetry must never start the canonical core runtime');
has(telemetry, /export async function stopTelemetryBootstrap/, 'telemetry must be reversible on master stop');

lacks(canonicalDashboard, /ensureCanonicalCryptoCrawlerRuntimeWiring/, 'legacy faucet control must not activate canonical runtime wiring');
has(canonicalDashboard, /Master Power is OFF/, 'legacy faucet control must fail closed while master power is off');

has(dashboard, /aria-label="CryptoCrawler master power"/, 'master dashboard must render the lifecycle power switch');
has(dashboard, /checked=\{isSystemRunning\}/, 'master switch must display backend runtime truth');
has(dashboard, /onCheckedChange=\{handleMasterPowerChange\}/, 'master switch must call the lifecycle handler');
has(dashboard, /apiRequest\('\/admin\/crypto\/start',\s*'POST'\)/, 'dashboard start must use canonical start endpoint');
has(dashboard, /apiRequest\('\/admin\/crypto\/stop',\s*'POST'\)/, 'dashboard stop must use canonical stop endpoint');

has(boot, /stopCryptoCrawlerRuntime/, 'central graceful shutdown must stop CryptoCrawler before process exit');
has(boot, /\[SHUTDOWN\] CryptoCrawler stopped/, 'graceful shutdown must expose CryptoCrawler shutdown completion');

const reversibleLoops = [
  ['server/services/cryptocrawl/integration/order-book-evolution-wiring.ts', /export function stopOrderBookEvolutionWiring/],
  ['server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts', /export function stopCexFourModeObservabilityWiring/],
  ['server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts', /export function stopCexInventoryReadinessWiring/],
  ['server/services/cryptocrawl/integration/computational-reactor-wiring.ts', /export function stopComputationalReactorWiring/],
  ['server/services/cryptocrawl/integration/prediction-market-discovery-wiring.ts', /export function stopPredictionMarketDiscoveryWiring/],
  ['server/services/cryptocrawl/integration/economic-transformation-wiring.ts', /export function stopEconomicTransformationWiring/],
  ['server/services/cryptocrawl/integration/bps-compression-mesh.ts', /export function stopBpsCompressionMesh\s*\(/],
  ['server/services/cryptocrawl/integration/bps-frontier-wave3-wiring.ts', /export function stopBpsFrontierWave3Wiring\s*\(/],
  ['server/services/cryptocrawl/integration/bps-decomposition-observability.ts', /export function stopBpsDecompositionObservability/],
  ['server/services/cryptocrawl/integration/runtime-observability.ts', /export function stopCryptoRuntimeObservability/],
  ['server/services/cryptocrawl/discovery/stage-one-measurement-recovery.ts', /export function stopStageOneMeasurementRecovery/],
  ['server/services/cryptocrawl/discovery/stage-one-dex-mempool-repair.ts', /export function stopStageOneDexMempoolRepair/],
  ['server/services/cryptocrawl/discovery/stage-one-dex-mempool-velora-recovery.ts', /export function stopStageOneVeloraRecovery/],
];
for (const [path, pattern] of reversibleLoops) {
  has(read(path), pattern, `recurring CryptoCrawler loop must expose a reversible stop hook: ${path}`);
}

console.log('CRYPTOCRAWLER MANUAL MASTER LIFECYCLE VERIFIED');
