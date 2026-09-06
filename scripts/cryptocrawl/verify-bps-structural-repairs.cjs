const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(`[bps-structural-repairs] ${message}`); };

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const compression = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const gas = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const providers = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const rpc = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');
const ledger = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const treasury = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');
const resourceScheduler = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const measuredAdapter = read('server/services/cryptocrawl/execution/measured-topology-execution-adapter.ts');
const atomicPolicy = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const positiveCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');

// BPS floor/accounting: flash premium is a dedicated cost and min-output tolerance
// is not silently booked as a second expected loss.
must(discovery.includes('feeUsd: 0'), 'ZERO_CAPITAL_ATOMIC must not duplicate flash premium into exchange feeUsd');
must(discovery.includes('flashLoanFeeBps'), 'flash premium must remain explicitly attributable');
must(discovery.includes('expectedSlippageBps: 0'), 'direct quoted amountOut must not also book min-output tolerance as expected slippage');
must(discovery.includes('quoted_amount_out_embeds_current_route_economics'), 'route economics provenance must state quoted amountOut is authoritative');

// Unknown BPS evidence cannot be coerced into a false zero.
must(compression.includes("value === null || value === undefined || typeof value === 'boolean'"), 'BPS compression must preserve null/undefined/boolean economics as unknown');
must(compression.includes("typeof value === 'string' && value.trim() === ''"), 'blank BPS evidence must remain unknown');

// Zero-fee/zero-gas claims require evidence, never configuration alone.
must(gas.includes('sponsorOperatorMonetaryCostProvenZero === true'), 'sponsored zero-gas claim must require proven zero operator monetary cost');
must(gas.includes('nativeSystemOwnedProven === true'), 'native gas must require durable system-owned provenance');
must(gas.includes("paymentSource: 'provider_sponsored'"), 'sponsored payment source must remain explicit');
must(gas.includes("paymentSource: strictEligible ? 'system_owned_native' : 'unproven_native_balance'"), 'native payment-source provenance must remain explicit');

// Preserve the already-completed live zero-personal-cost admission work from
// PR #558 on the current structural branch. Generic sponsor readiness cannot
// stand in for proven zero-operator-cost gas provenance.
must(resourceScheduler.includes('evaluateAtomicZeroCapitalAdmission({'), 'live atomic leases must consume the universal zero-personal-cost policy');
must(resourceScheduler.includes('strictCanonicalGasDecision'), 'resource leases must reacquire canonical gas provenance at lease time');
must(resourceScheduler.includes('gasDecision.mode !== input.fundingMode'), 'caller gas mode must not override canonical gas truth');
must(resourceScheduler.includes("!['DEX_ATOMIC', 'LIQUIDATION'].includes(candidate.topology)"), 'measured atomic leases must bind to current DEX/liquidation candidates');
must(resourceScheduler.includes('completeMeasuredAtomicEconomics'), 'measured atomic leases must require current positive all-in economics');
must(measuredAdapter.includes('strictAtomicFundingMode'), 'DEX/liquidation execution must derive the canonical gas mode');
must(measuredAdapter.includes("decision.mode === 'sponsored' && decision.paymentSource !== 'provider_sponsored'"), 'sponsored measured atomic execution must require provider-sponsored provenance');
must(measuredAdapter.includes("decision.mode === 'native' && decision.paymentSource !== 'system_owned_native'"), 'native measured atomic execution must require system-owned provenance');
must(!measuredAdapter.includes("getGasSponsorManager().getReadiness().ready ? 'sponsored' : 'native'"), 'generic sponsor readiness must not choose zero-personal-cost execution mode');
must(atomicPolicy.includes('evaluateAtomicZeroCapitalAdmission'), 'universal zero-personal-cost admission policy must remain present');
must(positiveCapture.includes("deterministicNetProfitRule: 'profit_admission_authority'"), 'single canonical profit admission authority must remain in force');
must(positiveCapture.includes('arbitraryMinimumProfitUsd: false'), 'no arbitrary profit magnitude floor may return');

// 0x is current v2, and bad credentials/product entitlement are an unavailable
// optional resource with bounded retries rather than a permanent runtime failure loop.
must(providers.includes("'0x-version': 'v2'"), '0x requests must carry the v2 header');
must(providers.includes('https://api.0x.org/swap/allowance-holder/'), '0x AllowanceHolder v2 endpoint must be used');
must(providers.includes('ZEROX_AUTH_FAILURE_COOLDOWN_MS'), '0x auth/entitlement failures need bounded cooldown');
must(providers.includes("this.setProviderStatus('0x', 'unavailable'"), '0x entitlement/credential absence must be represented as unavailable');
must(providers.includes('authentication or product entitlement rejected'), '0x entitlement rejection must be recognized explicitly');

// RPC recovery: two independent no-key Ethereum transports, with the deprecated
// Cloudflare legacy public hostname removed from live mesh.
must(rpc.includes('https://ethereum-rpc.publicnode.com'), 'PublicNode Ethereum primary must remain present');
must(rpc.includes('https://eth.drpc.org/'), 'dRPC Ethereum secondary must be present');
must(!rpc.includes("ethereum: 'https://cloudflare-eth.com"), 'deprecated Cloudflare public Ethereum gateway must not be admitted');

// Terminal policy truth: code and telemetry must agree on the fixed 90/10 split.
must(ledger.includes('const PAYOUT_FRACTION = 0.90;'), 'terminal payout fraction must be 90%');
must(ledger.includes('const RETAINED_FRACTION = 0.10;'), 'retained system-capital fraction must be 10%');
must(treasury.includes('fixed_90_percent_terminal_realized_profit_to_eth_payout_10_percent_retained'), 'treasury runtime telemetry must report the actual fixed 90/10 policy');
must(!treasury.includes('first_three_fixed_60_percent'), 'obsolete 60%/55-65% treasury policy must not remain in live telemetry');

console.log('[bps-structural-repairs] PASS');
