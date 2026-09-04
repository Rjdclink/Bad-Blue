'use strict';

const fs = require('node:fs');

const operatorPath = 'server/services/cryptocrawl/governance/operator-trading-strategy.ts';
const migrationPath = 'server/migrations/043_cryptocrawler_profit_qualified_schedule.sql';
const schedulerPath = 'server/services/cryptocrawl/execution/canonical-execution-scheduler.ts';

const operator = fs.readFileSync(operatorPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const scheduler = fs.readFileSync(schedulerPath, 'utf8');

function must(text, needle, message) {
  if (!text.includes(needle)) throw new Error(message);
}

// Prove that the runtime implementation still uses the same policy boundaries
// exercised below. This verifier intentionally models only timing eligibility;
// canonical economics remains the sole authority that may admit a trade.
must(operator, 'const CYCLE_DAYS = 30;', 'Adaptive schedule must remain a fixed 30-calendar-day cycle');
must(operator, 'const PROFIT_DAYS_TARGET = 20;', 'Adaptive schedule must target 20 profit-qualified days');
must(operator, 'const BASELINE_ATTEMPT_DAYS_PER_CYCLE = 20;', 'Adaptive schedule must retain 20 randomized preferred attempt dates');
must(operator, 'calendarDaysRemaining <= neededProfitDays', 'Catch-up mode must activate when every remaining day is required or the target is already mathematically unreachable');
must(operator, 'remainingBaselineDays < neededProfitDays', 'Reserve-day promotion must activate before preferred dates become insufficient');
must(operator, "eligibilitySource = 'profit_day_target_reached'", 'Trading eligibility must stop once 20 profit-qualified days are proven');
must(migration, 'profit_qualified = next_realized > 0', 'Only terminal net-positive local days may remain profit-qualified');
must(migration, 'Missing the target never forces execution and never invalidates the cycle', 'Missing 20 profit days must be explicitly non-fatal');
must(scheduler, 'operatorStrategyProfitabilityAuthority: false', 'The schedule must never become profitability authority or force a trade');

function decide({
  dayOffset,
  qualifiedProfitDays,
  baselinePreferred,
  remainingBaselineDays,
  cycleDays = 30,
  profitDaysTarget = 20,
}) {
  if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset >= cycleDays) {
    throw new Error(`invalid dayOffset ${dayOffset}`);
  }
  const neededProfitDays = Math.max(0, profitDaysTarget - qualifiedProfitDays);
  const calendarDaysRemaining = Math.max(0, cycleDays - dayOffset);
  const targetStillMathematicallyReachable = neededProfitDays <= calendarDaysRemaining;

  if (qualifiedProfitDays >= profitDaysTarget) {
    return { isTradeDay: false, source: 'profit_day_target_reached', neededProfitDays, calendarDaysRemaining, targetStillMathematicallyReachable };
  }
  if (baselinePreferred) {
    return { isTradeDay: true, source: 'baseline_randomized_attempt', neededProfitDays, calendarDaysRemaining, targetStillMathematicallyReachable };
  }
  if (calendarDaysRemaining <= neededProfitDays) {
    return { isTradeDay: true, source: 'catch_up_all_remaining_days', neededProfitDays, calendarDaysRemaining, targetStillMathematicallyReachable };
  }
  if (remainingBaselineDays < neededProfitDays) {
    return { isTradeDay: true, source: 'adaptive_reserve_promotion', neededProfitDays, calendarDaysRemaining, targetStillMathematicallyReachable };
  }
  return { isTradeDay: false, source: 'learning_reserve', neededProfitDays, calendarDaysRemaining, targetStillMathematicallyReachable };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// User edge case: after 15 calendar days only 4 days are profitable. Sixteen
// more are needed but only 15 dates remain. The system must not crash or pretend
// the target is reachable; it should simply make every remaining date eligible.
{
  const result = decide({ dayOffset: 15, qualifiedProfitDays: 4, baselinePreferred: false, remainingBaselineDays: 8 });
  assert(result.isTradeDay === true, '4-after-15 edge case must make the current reserve day eligible');
  assert(result.source === 'catch_up_all_remaining_days', '4-after-15 edge case must enter catch-up-all-remaining mode');
  assert(result.neededProfitDays === 16 && result.calendarDaysRemaining === 15, '4-after-15 arithmetic must remain exact');
  assert(result.targetStillMathematicallyReachable === false, '4-after-15 edge case must truthfully report that 20 is no longer mathematically reachable');
}

// Reachable catch-up: 8 qualified days after 15 calendar days means 12 are still
// needed from 15 dates. If only 10 preferred baseline dates remain, the reserve
// day must promote so the target remains possible without forcing bad economics.
{
  const result = decide({ dayOffset: 15, qualifiedProfitDays: 8, baselinePreferred: false, remainingBaselineDays: 10 });
  assert(result.isTradeDay === true, 'Reachable catch-up case must promote a reserve day');
  assert(result.source === 'adaptive_reserve_promotion', 'Reachable catch-up case must use adaptive reserve promotion');
  assert(result.targetStillMathematicallyReachable === true, '8-after-15 case should remain mathematically reachable');
}

// If enough preferred randomized dates still exist, reserve dates remain learning
// days; the scheduler must not unnecessarily increase trading frequency.
{
  const result = decide({ dayOffset: 15, qualifiedProfitDays: 8, baselinePreferred: false, remainingBaselineDays: 12 });
  assert(result.isTradeDay === false, 'Reserve day must remain learning-only when preferred dates are still sufficient');
  assert(result.source === 'learning_reserve', 'Sufficient-capacity reserve day must remain learning reserve');
}

// Preferred dates remain eligible while the target is unfinished.
{
  const result = decide({ dayOffset: 6, qualifiedProfitDays: 3, baselinePreferred: true, remainingBaselineDays: 16 });
  assert(result.isTradeDay === true && result.source === 'baseline_randomized_attempt', 'Randomized preferred day must remain trading-eligible before target completion');
}

// Once 20 net-positive days are terminally proven, all later dates become
// learning-only regardless of whether they were originally randomized attempts.
{
  const result = decide({ dayOffset: 24, qualifiedProfitDays: 20, baselinePreferred: true, remainingBaselineDays: 4 });
  assert(result.isTradeDay === false, 'Trading must stop for the cycle after 20 profit-qualified days');
  assert(result.source === 'profit_day_target_reached', 'Completed cycle must expose profit-day-target-reached state');
}

// Last-day impossible case stays non-fatal and best-effort: it may be eligible,
// but the schedule itself never claims authority to execute an unprofitable trade.
{
  const result = decide({ dayOffset: 29, qualifiedProfitDays: 18, baselinePreferred: false, remainingBaselineDays: 0 });
  assert(result.isTradeDay === true, 'Final day must remain eligible when profit-day target is unfinished');
  assert(result.targetStillMathematicallyReachable === false, 'Final-day 18/20 state must truthfully report mathematical impossibility');
}

console.log('Profit-qualified 20-of-30 adaptive schedule behavior checks passed');
