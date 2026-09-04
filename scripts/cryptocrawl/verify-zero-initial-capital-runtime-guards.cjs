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

const strict = read(strictPath);
const balancer = read(balancerPath);
const postOp = read(postOpPath);
const inner = read(innerPath);
const outer = read(outerPath);

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

console.log('zero-initial-capital runtime guards: structural checks passed');
