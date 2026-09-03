const assert = require('node:assert/strict');
const fs = require('node:fs');

const stage = fs.readFileSync('server/services/cryptocrawl/governance/stage-management.ts', 'utf8');
const risk = fs.readFileSync('server/services/cryptocrawl/governance/risk-governor.ts', 'utf8');
const ladder = fs.readFileSync('server/services/cryptocrawl/governance/profit-ladder.ts', 'utf8');

const stage2Plus = stage.slice(stage.indexOf('private checkAdvancementCriteria()'), stage.indexOf('private getAutomaticAdvancementBlockers'));

for (const forbidden of [
  'm.totalTrades < 100',
  'm.successRate < 0.6',
  'm.sharpeRatio < 1.0',
  'm.monteCarloPassRate < 0.8',
  'requiredUptimeHours',
]) {
  assert.ok(!stage2Plus.includes(forbidden), `Stage 2+ historical soft gate returned: ${forbidden}`);
}

assert.match(stage2Plus, /Stage 2\+ deliberately has no historical-performance requirement/);
assert.match(stage2Plus, /!this\.state\.blockingAnomaly/);
assert.match(stage2Plus, /!this\.state\.killSwitchActive/);
assert.match(stage2Plus, /currentDrawdownPercent <= this\.config\.maxDrawdownPercent/);

const monteCarloConfigValues = [...stage.matchAll(/requiresMonteCarloConsensus:\s*(true|false)/g)].map(match => match[1]);
assert.equal(monteCarloConfigValues.length, 6, 'Expected one Monte Carlo compatibility flag per stage');
assert.ok(monteCarloConfigValues.every(value => value === 'false'), 'Monte Carlo must not be configured as an execution/stage requirement');

assert.match(risk, /Current opportunity-bound Monte Carlo evidence is advisory only/);
assert.match(risk, /monteCarloExecutionAuthority: false/);
assert.ok(!risk.includes('assessment.reason = `Monte Carlo consensus failed:'), 'RiskGovernor must not restore Monte Carlo as an execution veto');
assert.ok(!/if\s*\(!monteCarloResult\.approved\)[\s\S]{0,300}return assessment;/.test(risk), 'RiskGovernor must not return a rejection solely from Monte Carlo');

const tierOneStart = ladder.indexOf("if (tier.id === 1) {");
const tierOneEnd = ladder.indexOf("} else {\n        if (performance.terminalSampleCount", tierOneStart);
assert.ok(tierOneStart >= 0 && tierOneEnd > tierOneStart, 'Could not isolate Profit Ladder Tier 1 criteria branch');
const tierOneCriteria = ladder.slice(tierOneStart, tierOneEnd);
assert.match(tierOneCriteria, /terminalWinningSamples <= 0/, 'Stage 2 must retain direct terminal-positive proof');
for (const forbidden of [
  'performance.daysAtTarget < tier.daysRequiredAtTarget',
  'performance.successRate < tier.minSuccessRate',
  'performance.realizedSharpeDayCount < MIN_REALIZED_SHARPE_DAYS',
  'performance.sharpeRatio < tier.minSharpeRatio',
  'monteCarloPassRate',
  'requiredUptimeHours',
]) {
  assert.ok(!tierOneCriteria.includes(forbidden), `Profit Ladder Tier 1 reintroduced a Stage-2 soft historical gate: ${forbidden}`);
}
assert.match(ladder, /stageTwoSoftHistoricalGateAuthority: false/);
assert.match(ladder, /terminal_positive_plus_hard_scale_facts/);

console.log('[stage-soft-gate-retirement] PASS: Stage 2 has no trade-count/days-at-target/win-rate/Sharpe/Monte-Carlo/uptime gate, Tier 1 retains terminal-positive plus hard scale facts, and Monte Carlo has no execution veto authority');
