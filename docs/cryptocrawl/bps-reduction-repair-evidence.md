# BPS reduction repair evidence — 2026-10-12

Scope: offline repairs to the BPS reducer, its gas economics, and passive dashboard visibility. No runtime startup, transactions, environment changes, merge, or deployment was performed.

## Research sequence and implementation

The investigation broadened from reducer arithmetic and actuator wiring to AMM size/impact curves, gas pricing, sponsorship liability, token valuation, and L2 fee components. Primary sources:

- https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol — constant-product output with pool fees. Used for a synthetic two-pool regression, not live market data.
- https://developers.uniswap.org/docs/sdks/v3/guides/swapping/quoting — fresh route quotes. Size hypotheses do not earn BPS credit until requoted.
- https://eips.ethereum.org/EIPS/eip-1559 — effective fee versus maximum fee cap. Dynamic native discovery now uses the existing expected-execution-price helper rather than maxFee-first accounting; execution fee limits are unchanged.
- https://docs.pimlico.io/guides/pricing and https://docs.pimlico.io/references/paymaster/verifying-paymaster/faqs — sponsor billing remains an economic liability. Dynamic sponsored discovery now uses sponsor pricing, ERC-4337 overhead and the configured billing surcharge, rather than ordinary native-gas pricing. An unproven sponsorship cannot erase gas.
- https://docs.optimism.io/op-stack/transactions/fees — execution, L1 data, and operator fees are separate components. The early discovery reserve is an estimate, not exact proof of these components; see limitation below.
- https://www.aave.com/docs/aave-v3/guides/flash-loans — flash-loan repayment includes protocol fees; measured funding costs remain deducted.

Implemented sequence:

1. Preserve known gas and relay costs, including higher alternative-route costs; zero template seeds cannot erase the observed floor.
2. Convert gas USD using the live input-token price instead of assuming every stablecoin equals exactly one dollar. Missing prices reject the measurement.
3. Calculate a bounded size probe from the observed gross edge, fixed gas/relay cost, flash premium and funding ceiling. Aim for +5 BPS where feasible; otherwise probe just beyond break-even. This is a search hypothesis, not credited savings.
4. Requote bounded sizes and alternate routes, deduct all quote/funding costs, and select by exact net-BPS ratios. Larger dollar profit cannot displace a better BPS result solely because it is larger.
5. Preserve freshness and strict positive-output execution gates. Fix the unbound conversion callback on the resident fast path and reject invalid future provider evidence.
6. Emit passive, bounded observations to the authenticated dashboard terminal: asset, starting BPS, measured BPS, timestamp and outcome. These are quote attempts, not settlement claims.

Additional repairs: unknown economics no longer coerce to zero; expired resident evidence cannot extend its lifetime; post-overlay candidates rerank; rejected deadline-expired promises are observed; repeated settlement updates count once in the learning governor.

## Validation

- `node scripts/cryptocrawl/verify-bps-reduction-behavior.cjs`: 24 checks passed, using real reducer modules with all transports mocked.
- 22 selected BPS/gas/lifecycle regression scripts passed, including the behavioral script.
- `npm run build:server`: passed.
- Changed dashboard pages and terminal: esbuild TSX compilation passed.
- `git diff --check`: passed.
- Synthetic AMM regression: -2.631566 to +10.3944 net BPS after two pool fees, price impact, and $3 gas. A separate negative case remains negative; no fabricated recovery.

## Limits and unresolved evidence

This is not a live profitability guarantee. No providers or trades were exercised. The generic discovery gas-unit envelope remains an estimate; smaller sizing BPS does not mean fewer gas units were consumed. The Optimism 1.75 multiplier does not independently measure L1 data/operator fees and must not be represented as exact all-in transaction proof. Exact transaction-specific L2 estimation/reconciliation needs a separate implementation and offline fixtures for the actual submission payloads. No artificial fee discount or zero-cost assumption was introduced to conceal this gap.

Browser interaction and visual rendering were not verified: the supplied workspace lacks React runtime dependencies. TSX compilation and passive buffer behavior were verified. Changes remain in a review branch, not deployed.

The earlier provider audit found public RPC alternatives plus optional named vendors, but operations retry sequentially and the two streaming lanes may share dRPC. Alchemy references remain; this patch does not claim a complete Alchemy removal or independently verified live redundancy.
