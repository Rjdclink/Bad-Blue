import assert from 'node:assert/strict';
import {
  InMemoryRailwayBootstrapBudgetLedger,
  RailwayBootstrapBudgetGovernor,
  RAILWAY_BOOTSTRAP_ABSOLUTE_MAX_MICRO_USD,
  estimateRailwayIncrementalMicroUsd,
} from '../../server/services/cryptocrawl/execution/adapters/railway-bootstrap-budget.js';

const governor = new RailwayBootstrapBudgetGovernor(new InMemoryRailwayBootstrapBudgetLedger());
const eventId = 'bootstrap-verification';
await governor.reserve(eventId, 'work-1', 900_000);
await governor.settle(eventId, 'work-1', 900_000);
await governor.reserve(eventId, 'work-2', 1_000_000);
await governor.settle(eventId, 'work-2', 1_000_000);
await assert.rejects(() => governor.reserve(eventId, 'work-3', 100_001), /RAILWAY_BOOTSTRAP_HARD_BUDGET_REACHED/);
assert.equal(estimateRailwayIncrementalMicroUsd({
  cpuMilliseconds: 3_600_000,
  memoryMegabyteMilliseconds: 0,
  cpuUsdPerHour: '1.000000',
  memoryGbUsdPerHour: '0.000000',
}), 1_000_000);
assert.equal(RAILWAY_BOOTSTRAP_ABSOLUTE_MAX_MICRO_USD, 2_000_000);

console.log('Railway bootstrap budget verification passed');