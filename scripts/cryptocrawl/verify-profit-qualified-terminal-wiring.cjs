'use strict';

const fs = require('node:fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const operatorPath = 'server/services/cryptocrawl/governance/operator-trading-strategy.ts';
const evidencePath = 'server/services/cryptocrawl/governance/automatic-stage-progression.ts';
const migrationPath = 'server/migrations/043_cryptocrawler_profit_qualified_schedule.sql';
const operator = read(operatorPath);
const evidence = read(evidencePath);
const migration = read(migrationPath);

must(operatorPath, operator, 'async recordTerminalPnl(eventId: string, opportunityId: string, realizedPnlUsd: number)', 'Operator strategy must expose one signed terminal-PnL recorder');
must(operatorPath, operator, 'cryptocrawler_operator_strategy_record_terminal_pnl($1,$2,$3)', 'Operator strategy must delegate signed P&L to the migration-owned idempotent authority');
must(operatorPath, operator, 'state.learningMode is the authority here', 'Learning eligibility must support target-reached dates even when they were previously trading-eligible');
mustNot(operatorPath, operator, 'AND is_trade_day=false', 'Learning after the 20th qualified day must not be blocked by the date’s earlier trade-day classification');

must(evidencePath, evidence, "import { operatorTradingStrategy } from './operator-trading-strategy.js';", 'Canonical terminal evidence must be wired to operator scheduling');
must(evidencePath, evidence, 'feedback.settlement?.realized.netProfitUsd', 'Profit-day accounting must consume canonical terminal realized net P&L rather than recalculating economics');
must(evidencePath, evidence, 'terminalNetPnlUsd > 0 && feedback.settlement?.settlementConfirmed === true', 'Positive profit-day credit must require confirmed settlement');
must(evidencePath, evidence, 'terminalNetPnlUsd < 0 || positiveConfirmed', 'Known terminal losses must be able to remove a previously qualified day');
must(evidencePath, evidence, 'operatorTradingStrategy.recordTerminalPnl(eventId, feedback.opportunityId, terminalNetPnlUsd)', 'Signed P&L must use the same terminal event identity and opportunity lifecycle');

must(migrationPath, migration, "status IN ('RESERVED','SUBMITTED','TERMINAL')", 'Only canonical operator-reserved executions may bind terminal P&L to a schedule date');
must(migrationPath, migration, `IF target_date IS NULL THEN
    RETURN false;`, 'Off-schedule terminal evidence must not fall back to the current calendar date');
mustNot(migrationPath, migration, "target_date := (now() AT TIME ZONE 'America/Chicago')::date", 'Off-schedule terminal evidence must never be silently assigned to today');
must(migrationPath, migration, 'ON CONFLICT (event_id) DO NOTHING', 'Terminal P&L must remain exactly-once by event identity');
must(migrationPath, migration, 'profit_qualified = next_realized > 0', 'Daily qualification must remain reversible from aggregate signed realized P&L');

console.log('Profit-qualified terminal P&L wiring verification passed');
