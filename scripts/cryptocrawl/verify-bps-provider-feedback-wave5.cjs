const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const preselection = read('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts');
const providers = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const dynamic = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('provider feedback listens to the existing measured candidate registry', preselection.includes('measuredCandidateRegistry.onUpdate(recordProviderRepriceCandidate)'));
check('provider feedback is zero-capital topology only', preselection.includes("candidate.topology !== 'ZERO_CAPITAL_ATOMIC'"));
check('provider feedback requires exact measured flash fee evidence', preselection.includes("candidate.provenance.includes('measured_flash_loan_fee_exact_rate')"));
check('provider feedback requires verified receiver-bound provider selection', preselection.includes("candidate.provenance.includes('provider_selection_bound_to_verified_receiver')"));
check('synthetic provider feedback is refused', preselection.includes("candidate.provenance.includes('synthetic_evidence:false')"));
check('provider feedback is recorded at most once per opportunity', preselection.includes('seenProviderRepriceOpportunities.has(candidate.opportunityId)') && preselection.includes('seenProviderRepriceOpportunities.set(candidate.opportunityId, candidate.expiresAt)'));
check('provider feedback is bound to the exact route identity and measured route notional', preselection.includes('resolveRouteIdFromOpportunityId(candidate.opportunityId)') && preselection.includes('notionalUsd: item.recentMeasuredNotionalUsd'));
check('provider feedback expires and has a bounded max age', preselection.includes('feedback.expiresAt <= now') && preselection.includes('ZERO_CAPITAL_PROVIDER_REPRICE_FEEDBACK_MAX_AGE_MS'));
check('new raw quote invalidates older provider feedback', preselection.includes('feedback.observedAt < item.lastMeasuredAt'));
check('quote ranking may use fresh provider-repriced net BPS', preselection.includes('freshProviderFeedback(item, now)?.repricedNetProfitBps ?? item.recentNetProfitBps'));
check('adaptive quote budget uses ranking economics', preselection.includes('const rankingNet = rankingNetProfitBps(item, now);') && preselection.includes('if (rankingNet >= -scaleBps) promising += 1'));
check('hyperdynamic zero-capital gap uses ranking economics', preselection.includes('if (rankingNet <= 0) gaps.push(Math.abs(rankingNet))'));
check('raw deterministic-positive history remains raw quote authority', preselection.includes('const deterministicPositive = !!quote && quote.executablePositive && quote.netProfit > 0n') && preselection.includes('current.positiveQuotes += 1'));
check('Aries formation remains raw market quote authority', preselection.includes('netProfitBps: quote && Number.isFinite(quote.netProfitBps) ? quote.netProfitBps : null'));
check('provider feedback never mutates candidate registry', !/measuredCandidateRegistry\.(?:record|updateStatus)\(/.test(preselection));
check('provider feedback explicitly owns no deterministic-profit or execution authority', preselection.includes("authority: 'quote_budget_advisory_only'") && preselection.includes('deterministicProfitAuthority: false') && preselection.includes('executionAuthority: false'));
check('provider mesh still measures exact provider fees before repricing', providers.includes('calculateMeasuredFlashLoanFee(selectedSingle, opportunity.flashLoanAmount)') && providers.includes('measureFlashLoanProviders'));
check('Morpho zero flash fee remains measured provider-mesh evidence', providers.includes("selectedSingle.provider === 'morpho_blue'") && providers.includes('morpho_zero_flash_fee_applied:true'));
check('dynamic quote floor still cannot grant execution authority', dynamic.includes("positiveQuoteAuthority: 'strict_all_in_net_profit_gt_zero_only'") && dynamic.includes('syntheticEvidenceAllowed: false'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`bps-provider-feedback-wave5 verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[bps-provider-feedback-wave5] PASS: exact fresh receiver-bound flash-provider repricing now informs only the next zero-capital quote-budget ranking; deterministic-positive history, Aries market formation, execution authority and strict net-positive admission remain unchanged');
