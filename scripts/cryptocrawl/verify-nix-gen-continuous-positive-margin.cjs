const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function must(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

function mustNot(text, pattern, message) {
  if (pattern.test(text)) throw new Error(message);
}

const frontier = read('server/services/cryptocrawl/integration/bps-frontier-wave3-wiring.ts');
const anchors = read('server/services/cryptocrawl/execution/adapters/protocol-anchor-adapter.ts');
const runtimeDb = read('server/services/cryptocrawl/runtime/cryptocrawl-runtime-database.ts');

must(frontier, /https:\/\/api\.uniswap\.org\/v2\/orders/, 'Permissionless UniswapX order reservoir must use the official public orders endpoint');
must(frontier, /Math\.max\(1_000,[\s\S]*CRYPTOCRAWL_UNISWAPX_ORDER_POLL_MS/, 'UniswapX polling must stay bounded below the public 4 RPS ceiling');
must(frontier, /standingQuotePolicy: 'measured_execution_cost_plus_positive_target_margin'/, 'Standing quote policy must add a positive target margin to measured execution cost');
must(frontier, /candidatePromotionPolicy: 'only_after_exact_current_order_resolution_plus_callback_execution_proof_plus_strict_positive_all_in_net'/, 'Intent candidates must fail closed until exact executable callback economics are proven');
must(frontier, /canonicalCandidateRowsCreated: 0/, 'Public order discovery must not manufacture executable candidates');
must(frontier, /syntheticProfitAllowed: false/, 'Synthetic intent profit must stay prohibited');
must(frontier, /independentExecutionAuthority: false/, 'Intent reservoir must not create a parallel execution authority');
must(frontier, /realizedProfitStillRequiresCounterpartyFill: true/, 'Standing positive margin must not be mislabeled as guaranteed realized profit');
must(frontier, /uniswapXCallbackModel: 'input_tokens_arrive_before_callback_route_output_payment'/, 'Zero-prefund callback model must remain explicit');

must(anchors, /\[ProtocolAnchor\] Exact live anchor leg quoted/, 'Successful protocol-anchor calls must be visible in production telemetry');
must(anchors, /\[ProtocolAnchor\] Exact live anchor leg failed closed/, 'Failed protocol-anchor calls must expose exact fail-closed telemetry');
must(anchors, /quoteAuthority: 'direct_live_contract_state'/, 'Protocol-anchor quote authority must remain direct live contract state');
must(anchors, /syntheticEconomicsAllowed: false/g, 'Protocol-anchor telemetry must prohibit synthetic economics');
must(anchors, /throw error;/, 'Anchor quote failure must still reject rather than being converted to a synthetic quote');

must(runtimeDb, /targetPool\.on\('acquire'/, 'Checked-out Overflow client guard must attach on every pool acquisition');
mustNot(runtimeDb, /targetPool\.on\('connect',[\s\S]{0,160}Checked-out/, 'Checked-out client guard must not rely on one-time physical connect events');

console.log(JSON.stringify({
  ok: true,
  continuousPositiveMargin: {
    source: 'UniswapX public permissionless signed-order reservoir',
    standingMargin: 'measured execution cost plus positive target margin',
    realizedProfitGuaranteedWithoutFill: false,
    candidatePromotion: 'exact current order + callback proof + strict positive all-in net only',
  },
  protocolAnchorTelemetry: true,
  dbAcquireGuard: true,
  independentExecutionAuthority: false,
  syntheticProfitAllowed: false,
}, null, 2));
