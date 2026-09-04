const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function requireText(path, text, needle) {
  if (!text.includes(needle)) throw new Error(`missing ${needle} in ${path}`);
}

const strictPath = 'server/services/cryptocrawl/runtime/strict-zero-initial-capital-policy-wiring.ts';
const balancerPath = 'server/services/cryptocrawl/runtime/balancer-operational-profit-recipient-wiring.ts';
const postOpPath = 'server/services/cryptocrawl/runtime/zero-capital-postop-cost-reporting-wiring.ts';
const innerPath = 'server/services/cryptocrawl/runtime/alchemy-standard-rpc-first-wiring.ts';
const outerPath = 'server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts';
const operatorPath = 'server/services/cryptocrawl/governance/operator-trading-strategy.ts';

const strict = read(strictPath);
const balancer = read(balancerPath);
const postOp = read(postOpPath);
const inner = read(innerPath);
const outer = read(outerPath);
const operator = read(operatorPath);

requireText(strictPath, strict, "id.includes('external-sponsor')");
requireText(strictPath, strict, 'ordinaryOperatorBilledSponsorshipColdStartEligible: false');
requireText(strictPath, strict, 'opportunityBackedErc20PostOpColdStartEligible: true');
requireText(balancerPath, balancer, "from '../execution/adapters/dual-flash-loan-provider-selection-registry.js'");
requireText(balancerPath, balancer, 'profitRecipient: wallet.address');
requireText(balancerPath, balancer, "funding.mode === 'native'");
requireText(postOpPath, postOp, 'gasUsd: providerFeeUsd');
requireText(postOpPath, postOp, 'no_double_subtraction');
requireText(innerPath, inner, 'ensureBalancerOperationalProfitRecipientWiring();');
requireText(innerPath, inner, 'ensureStrictZeroInitialCapitalPolicyWiring();');
requireText(innerPath, inner, 'ensureZeroInitialCapitalDynamicExecutionWiring();');
requireText(outerPath, outer, 'ensureZeroCapitalPostOpCostReportingWiring();');

// node-postgres converts PostgreSQL DATE values to JavaScript Date by default.
// The operator strategy must normalize those values back to calendar keys before
// date arithmetic, otherwise the canonical scheduler fails closed and blocks the
// zero-capital execution path even when every funding/economics gate is healthy.
requireText(operatorPath, operator, 'function databaseDateKey(value: unknown): string');
requireText(operatorPath, operator, 'databaseDateKey(control.rows[0].anchor_date)');
requireText(operatorPath, operator, 'databaseDateKey(reservation.rows[0].local_date)');
requireText(operatorPath, operator, 'localDate: databaseDateKey(row.local_date)');
requireText(operatorPath, operator, 'cycleStart: databaseDateKey(row.cycle_start)');
requireText(operatorPath, operator, 'cycleEnd: databaseDateKey(row.cycle_end)');

console.log('zero-initial-capital runtime guards: structural checks passed');
