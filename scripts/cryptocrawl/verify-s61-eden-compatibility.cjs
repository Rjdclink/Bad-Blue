const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const requireText = (s, n, l) => { if (!s.includes(n)) failures.push(`${l}: missing ${JSON.stringify(n)}`); };
const forbidText = (s, n, l) => { if (s.includes(n)) failures.push(`${l}: forbidden ${JSON.stringify(n)}`); };

const eden = read('server/services/cryptocrawl/core/eden-storage.ts');
const adapter = read('server/services/cryptocrawl/intelligence/canonical-legacy-knowledge-adapter.ts');
const migration = read('server/migrations/013_cryptocrawler_private_intelligence_memory.sql');
const canonicalIndex = read('server/services/cryptocrawl/index.ts');
const legacyIndex = read('server/services/cryptocrawl/legacy/index.ts');

requireText(eden, 'observeLegacyCompatibilityArtifact', 'Eden writes through canonical compatibility mapping');
requireText(eden, "EDEN_DURABLE_AUTHORITY = 'canonical_private_intelligence_schema'", 'Eden durable authority is canonical private memory');
requireText(eden, 'EDEN_EXECUTION_AUTHORITY = false', 'Eden cannot execute');
requireText(eden, 'EDEN_SETTLEMENT_AUTHORITY = false', 'Eden cannot settle');
requireText(eden, 'HOT_LIMIT_PER_TYPE', 'Eden compatibility hot state is bounded');
forbidText(eden, 'Math.random', 'Eden cannot fabricate random learning identity');
forbidText(eden, 'setInterval(', 'Eden cannot run a second durable replication loop');
forbidText(eden, 'eden_', 'Eden cannot require a second eden_* database schema');

for (const kind of ['strategy_template','pattern','lesson','risk','opportunity','failure','state_snapshot','cain_state','evolution','cataclysm']) {
  requireText(adapter, `'${kind}'`, `canonical adapter maps ${kind}`);
}
for (const table of ['private.cryptara_patterns','private.cryptara_state_snapshots','private.cryptara_decision_events','private.cryptara_risk_snapshots','private.cryptara_anomaly_events']) {
  requireText(adapter, table, `legacy compatibility maps into ${table}`);
  requireText(migration, table, `canonical migration owns ${table}`);
}
requireText(adapter, "'advisory_only'", 'legacy artifacts are advisory only');
requireText(adapter, "'not_execution_evidence'", 'legacy artifacts are not execution evidence');
requireText(adapter, 'authoritativeExecutionEvidence: false', 'legacy payload cannot claim execution evidence');
requireText(adapter, 'authoritativeProfitEvidence: false', 'legacy payload cannot claim profit evidence');
requireText(adapter, 'executionDependency: false', 'legacy persistence degradation cannot block execution');
forbidText(adapter, 'executeVerifiedArbitragePlan', 'compatibility adapter cannot execute');
forbidText(adapter, 'canonicalExecutionScheduler', 'compatibility adapter cannot schedule execution');

forbidText(canonicalIndex, 'edenStorage', 'canonical public surface cannot expose Eden');
requireText(legacyIndex, "export * as edenStorage from '../core/eden-storage.js'", 'Eden remains available only through legacy compatibility surface');
requireText(legacyIndex, 'LEGACY_CRYPTOCRAWLER_EXECUTION_ALLOWED = false', 'legacy surface cannot execute');

if (failures.length) {
  console.error('[s61-eden-compatibility] FAIL');
  failures.forEach(f => console.error(` - ${f}`));
  process.exit(1);
}
console.log('[s61-eden-compatibility] PASS — Eden/Cain compatibility maps to one private intelligence schema without execution or settlement authority');
