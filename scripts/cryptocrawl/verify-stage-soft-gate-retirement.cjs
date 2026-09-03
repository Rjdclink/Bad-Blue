const assert = require('node:assert/strict');
const fs = require('node:fs');

const stage = fs.readFileSync('server/services/cryptocrawl/governance/stage-management.ts', 'utf8');
const risk = fs.readFileSync('server/services/cryptocrawl/governance/risk-governor.ts', 'utf8');

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

console.log('[stage-soft-gate-retirement] PASS: Stage 2+ has no 100-trade/win-rate/Sharpe/Monte-Carlo/uptime gate and Monte Carlo has no execution veto authority');
