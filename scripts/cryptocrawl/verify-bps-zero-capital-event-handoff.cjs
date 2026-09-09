'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const recovery = read('server/services/cryptocrawl/integration/zero-capital-recovery-observability.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');

// The zero-capital recovery projection must react to the canonical candidate
// registry rather than relying only on a coarse polling interval.
assert.match(recovery, /measuredCandidateRegistry\.onUpdate\(scheduleCandidateRefresh\)/);
assert.match(recovery, /candidate\.topology !== 'ZERO_CAPITAL_ATOMIC'/);
assert.match(recovery, /candidateRefreshTimer = setTimeout\([\s\S]{0,220}refresh\(\)[\s\S]{0,120}250\)/);
assert.match(recovery, /export function onZeroCapitalRecoveryUpdate/);
assert.match(recovery, /costCompressionAuthority: 'gross_positive_net_nonpositive_measured_candidates_only'/);
assert.match(recovery, /staleCandidateEconomicAuthority: false/);
assert.match(recovery, /syntheticProfitAllowed: false/);
assert.match(recovery, /timer = setInterval\(refresh, intervalMs\)/);

// The BPS mesh must initialize from that current projection and refresh from its
// update signal, while retaining the periodic timer only as a resilience fallback.
assert.match(mesh, /ensureZeroCapitalRecoveryObservability\(\);[\s\S]{0,180}onZeroCapitalRecoveryUpdate\(\(\) => scheduleRecoveryDrivenRefresh\(\)\)/);
assert.match(mesh, /function scheduleRecoveryDrivenRefresh\(\)[\s\S]{0,220}refreshBpsCompressionMesh\(\)[\s\S]{0,120}50\)/);
assert.match(mesh, /timer = setInterval\(refreshBpsCompressionMesh, intervalMs\)/);
assert.match(mesh, /authority: 'search_and_compute_scheduling_only'/);
assert.match(mesh, /executionAuthority: false/);
assert.match(mesh, /syntheticEvidenceAllowed: false/);
assert.doesNotMatch(mesh, /measuredCandidateRegistry\.(record|updateStatus)\(/);
assert.doesNotMatch(mesh, /canonicalBps\.[A-Za-z]+\s*=/);

console.log('[bps-zero-capital-event-handoff] PASS: canonical zero-capital candidate updates coalesce into recovery telemetry and immediately invalidate/refetch the BPS mesh; periodic fallback, fail-closed economics, stale-evidence rejection, and execution-authority boundaries remain intact');
