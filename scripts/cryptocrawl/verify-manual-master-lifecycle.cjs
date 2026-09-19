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
const productionBootstrap = read('server/cryptara-bootstrap-entry.ts');
const manualPower = read('server/services/cryptocrawl/runtime/manual-power-state.ts');
const runtimeDatabase = read('server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts');
const overflowBootstrap = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.ts');
const migrations = read('server/migrations/reconcileAppSchema.ts');
const routes = read('server/routes.ts');
const beam = read('server/services/cryptocrawl/beam/beam.ts');
const bridgeApi = read('server/services/cryptocrawl/api/bridge-api.ts');
const learningLifecycle = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');
const deepLearning = read('server/services/cryptocrawl/learning/deep-learning-store.ts');
const instantLearning = read('server/services/cryptocrawl/learning/instant-learning-engine.ts');
const learningCompat = read('server/services/cryptocrawl/learning/supabase-compatibility.ts');
const eden = read('server/services/cryptocrawl/eden/service.ts');
const truthfulDiagnostics = read('server/services/cryptocrawl/api/truthful-admin-diagnostics.ts');

lacks(boot, /automaticCryptoCrawlerRuntimeRequired/, 'server boot must not own CryptoCrawler automatic resume');
lacks(boot, /startCryptoCrawlerRuntime/, 'server boot must never invoke the CryptoCrawler start authority');
has(boot, /CryptoCrawler remains fully OFF pending manual dashboard start/, 'server boot must explicitly preserve stopped-by-default intent');
has(boot, /cryptocrawler_master_power_off_at_boot/, 'server boot must emit explicit OFF-state telemetry');
lacks(boot, /await\s+startCryptaraHyperBridgeBootstrap\(\)/, 'server boot must never probe CryptoCrawler Overflow');
lacks(boot, /await\s+ensureCryptocrawlOverflowRuntimeSchema\(\)/, 'server boot must never verify CryptoCrawler schema');

has(productionBootstrap, /CRYPTOCRAWLER_MANUAL_POWER_PHASE\s*=\s*'OFF'/, 'production wrapper must default CryptoCrawler power OFF');
lacks(productionBootstrap, /startCryptaraHyperBridgeBootstrap\s*\(/, 'production wrapper must not start the Overflow bridge');
lacks(productionBootstrap, /ensureCryptocrawlOverflowRuntimeSchema\s*\(/, 'production wrapper must not touch CryptoCrawler schema');
has(productionBootstrap, /await import\('\.\/index\.js'\)/, 'production wrapper must load the application without CryptoCrawler prebootstrap');

has(manualPower, /let\s+phase:\s*CryptoCrawlerManualPowerPhase\s*=\s*'OFF'/, 'manual power authority must default OFF');
has(manualPower, /phase\s*===\s*'STARTING'\s*\|\|\s*phase\s*===\s*'ON'/, 'database access must be limited to startup/on phases');
lacks(manualPower, /phase\s*===\s*'STOPPING'/, 'STOPPING must reject all new CryptoCrawler database work');
has(runtimeDatabase, /installManualPowerDatabaseGuard\(nextPool,\s*'ordinary'\)/, 'ordinary CryptoCrawler DB pool must be fail-closed behind manual power');
has(runtimeDatabase, /installManualPowerDatabaseGuard\(nextPool,\s*'coordination'\)/, 'coordination CryptoCrawler DB pool must be fail-closed behind manual power on each recreation');
has(runtimeDatabase, /export async function closeCryptocrawlRuntimeDatabasePools\(\)/, 'master stop must close CryptoCrawler database sockets');
has(runtimeDatabase, /export function reopenCryptocrawlRuntimeDatabasePools\(\)/, 'manual start must recreate CryptoCrawler database pools after a true stop');
has(overflowBootstrap, /if\s*\(!isCryptoCrawlerDatabaseAccessAllowed\(\)\)/, 'Overflow bootstrap must fail closed while master power is OFF');
has(overflowBootstrap, /await closeCryptaraParallelProxyPool\(\)/, 'Overflow bootstrap stop must close auxiliary Supabase sockets');
has(overflowBootstrap, /reopenCryptaraParallelProxyPool\(\)/, 'manual start must recreate the auxiliary Overflow pool before use');
has(migrations, /Skipped while master power is OFF; zero CryptoCrawler schema I\/O executed/, 'application startup migrations must skip CryptoCrawler schema I/O while OFF');

lacks(routes, /startBeamOnBoot\(\)/, 'application route registration must not emit a CryptoCrawler Beam pulse at boot');
has(beam, /if\s*\(!isCryptoCrawlerMasterPowerOn\(\)\)[\s\S]{0,180}CRYPTOCRAWLER_MASTER_POWER_OFF/, 'Beam emission must fail closed while Master Power is OFF');
has(bridgeApi, /router\.use\([\s\S]{0,300}!isCryptoCrawlerMasterPowerOn\(\)[\s\S]{0,300}CRYPTOCRAWLER_MASTER_POWER_OFF/, 'bridge/RPC endpoints must fail closed while Master Power is OFF');
lacks(deepLearning, /constructor\(\)[\s\S]{0,160}initializeSupabase\(\)/, 'DeepLearningStore must not bind Supabase at module construction');
lacks(instantLearning, /constructor\(\)[\s\S]{0,160}initializeSupabase\(\)/, 'InstantLearningEngine must not bind Supabase at module construction');
lacks(learningCompat.trimEnd(), /normalizeLegacySupabaseLearningEnvironment\(\);\s*$/, 'legacy learning compatibility must not rewrite Supabase aliases at module import');
has(learningLifecycle, /normalizeLegacySupabaseLearningEnvironment\(\)/, 'manual runtime activation must explicitly prepare legacy learning compatibility');
has(learningLifecycle, /export async function stopLearningLifecycleWiring\(\)/, 'learning persistence must expose a reversible manual stop hook');
lacks(learningLifecycle, /stopLearningLifecycleWiring[\s\S]{0,500}await\s+deep\.stop\(\)/, 'learning shutdown must not issue a final Supabase persistence write after STOPPING begins');
has(eden, /if\s*\(!isCryptoCrawlerDatabaseAccessAllowed\(\)\)[\s\S]{0,120}CRYPTOCRAWLER_MASTER_POWER_OFF/, 'Eden persistence must fail closed while CryptoCrawler is not STARTING or ON');
has(eden, /onCryptoCrawlerManualPowerPhaseChange[\s\S]{0,300}this\.supabase\s*=\s*null/, 'Eden must drop its Supabase client reference when Master Power reaches OFF');
has(canonicalRuntime, /stopLearningLifecycleWiring\(\)/, 'canonical master stop must stop learning persistence and detach Supabase mirrors');
has(learningLifecycle, /normalizeLegacySupabaseLearningEnvironment\(\)[\s\S]{0,500}activateSupabaseMirror\(\)/, 'manual runtime activation must bind the legacy learning mirror only after power opens');

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
has(admin, /setCryptoCrawlerManualPowerPhase\('STARTING'\)/, 'manual start must open the bounded startup phase');
has(admin, /reopenCryptocrawlRuntimeDatabasePools\(\)/, 'manual start must reopen dedicated CryptoCrawler database pools before Overflow bootstrap');
has(admin, /closeCryptocrawlRuntimeDatabasePools\(\)/, 'manual stop and failed-start rollback must close dedicated CryptoCrawler database pools');
has(admin, /startCryptaraHyperBridgeBootstrap\(\)/, 'manual start must own Overflow bootstrap');
has(admin, /ensureCryptocrawlOverflowRuntimeSchema\(\)/, 'manual start must own CryptoCrawler schema verification');
has(admin, /setCryptoCrawlerManualPowerPhase\('ON'\)/, 'successful manual start must transition power ON');
has(admin, /setCryptoCrawlerManualPowerPhase\('STOPPING'\)/, 'manual stop must enter bounded cleanup phase');
has(admin, /setCryptoCrawlerManualPowerPhase\('OFF'\)/, 'manual stop must close all CryptoCrawler database access');
has(admin, /stopCryptaraHyperBridgeBootstrap\(\)/, 'manual stop must stop the Overflow bridge');
has(admin, /cryptaraGovernance\.shutdown\(\)/, 'manual stop must stop Cryptara governance/runtime');
has(admin, /uninstallCryptaraSuperWorkerAdmission\(\)/, 'manual stop and failed start must remove CryptoCrawler DB admission');
has(admin, /resetGovernanceInitializationForManualStop\(\)/, 'manual stop must reset governance initialization so the next manual start reinstalls resources');
has(admin, /rollbackCryptoCrawlerManualStart\(\)/, 'all failed-start paths must converge on the hard-OFF rollback');

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
has(canonicalDashboard, /if\s*\(!isCryptoCrawlerMasterPowerOn\(\)\)[\s\S]{0,500}source:\s*'master_power_off'/, 'dashboard network-facing reads must return an offline snapshot while master power is off');
has(canonicalDashboard, /onCryptoCrawlerManualPowerPhaseChange[\s\S]{0,400}dashboardIntervals\.clear\(\)/, 'dashboard recurring timers must be cleared when master power transitions OFF');
has(admin, /router\.get\('\/health'[\s\S]{0,1800}!isCryptoCrawlerMasterPowerOn\(\)[\s\S]{0,1400}queried:\s*false/, 'legacy admin health polling must perform zero database/RPC I/O while OFF');
has(truthfulDiagnostics, /router\.get\('\/health'[\s\S]{0,1600}!isCryptoCrawlerMasterPowerOn\(\)[\s\S]{0,1400}queried:\s*false/, 'front-of-router truthful health polling must perform zero database/RPC I/O while OFF');

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
