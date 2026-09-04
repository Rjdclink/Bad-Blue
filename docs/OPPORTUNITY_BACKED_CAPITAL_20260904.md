# Opportunity-Backed Capital Architecture — 2026-09-04

## Objective

CryptoCrawler must be able to bootstrap without the operator injecting principal or native gas, then use only verified internally generated profit to fund strategies that require persistent inventory.

This is **zero external user capital**, not a claim that validators, lenders, paymasters, relayers, or liquidity providers provide resources for free. Every third-party cost remains canonical economics and must be repaid from the opportunity or later internally generated profit.

## Core result

The missing primitive is a two-part atomic bootstrap:

1. **Principal is temporary and atomic.** Source trade inventory from protocol transient accounting or a flash-liquidity lender. Repay before the transaction completes or revert.
2. **Gas is opportunity-backed.** An ERC-4337/EIP-7702 paymaster fronts native gas, then collects an ERC-20 gas charge after the atomic call has created the profit-token balance. The gas-token charge is a real cost and must be strictly smaller than the receiver-guaranteed profit.

After the first terminally verified residual profit, the existing capital provenance lifecycle can transition the system into SELF_FUNDED mode. Persistent strategies then consume only retained internally generated capital rather than operator capital.

## Public mechanism evidence incorporated

### Atomic/transient principal

- ERC-3156 standardizes uncollateralized flash liquidity that must be returned, plus any fee, before transaction end.
- Morpho exposes same-transaction flash loans and currently reports zero flash fee in its contract documentation.
- Euler EVault exposes `flashLoan`; EVC batching/deferred checks permit multi-action atomic workflows so final constraints, not intermediate balances, govern supported operations.
- Uniswap v4 flash accounting carries internal currency deltas across multiple actions and requires net settlement at the end of the unlock. This is the closest protocol-native form of temporary transaction credit.
- Balancer v3 Vault transient accounting similarly permits temporary token debt with `sendTo`, then requires all non-zero deltas to be settled before the unlock completes.
- Existing CryptoCrawler Aave/Balancer receiver infrastructure already proves the same architectural pattern for current atomic arbitrage and Aave liquidation paths.

### Opportunity-backed gas

- ERC-4337 explicitly allows a paymaster to front native gas and run `postOp` after account execution.
- Alchemy Wallet API ERC-20 post-operation mode fronts native gas, injects an approval in the same atomic operation, and pulls the ERC-20 payment after execution. `wallet_prepareCalls` reports `feePayment.maxAmount`; `maxTokenAmount` can hard-cap the charge. The API type also exposes `postOpSettings.balanceCheck=false`, which is the capability required for a balance created during the operation rather than a required pre-existing balance. This mode must be runtime-proven before it becomes execution authority.
- ZeroDev documents the same economic model more explicitly for DeFi: an ERC-20 paymaster can use `gasToken: toToken`, i.e. pay gas from the swap output token. Its current hosted ERC-20 paymaster supports USDC on Ethereum, Polygon, Base, Optimism, and Arbitrum and applies a quoted premium.

### Atomic matching / opportunity-supplied inventory

- Historical 0x v3 `matchOrders` directly demonstrated two complementary orders being filled atomically without the matcher holding capital upfront, while the matcher receives the spread. This is architectural precedent, **not** authority to call deprecated v3 APIs in current production.
- CoW Protocol uses permissionless combinatorial batch auctions and Coincidence of Wants, which can match complementary signed intents before touching external liquidity.
- UniswapX exposes permissionless fillers for open auction orders. Filler economics still need gas and any temporary inventory to be sourced through the same opportunity-backed/flash-capital layer.
- Salty.IO's audited Automatic Atomic Arbitrage design demonstrated arbitrage integrated into swap settlement itself and redistributed the captured profit internally. Its audit history also demonstrates why this pattern still requires strict manipulation, liquidity, reentrancy, and accounting controls.

## Strategy capital classes

### Class A — can be zero-user-capital from the first execution

These can complete within one atomic settlement boundary and therefore can use temporary principal plus opportunity-backed gas:

1. DEX / triangular / multi-hop arbitrage.
2. Atomic liquidations with immediate collateral unwind.
3. Backruns and atomic MEV bundles when the all-in opportunity exceeds builder/tip and gas costs.
4. Complementary signed-order matching / Coincidence-of-Wants solver fills.
5. Inventoryless RFQ/filler execution where temporary inventory is borrowed and repaid in the same settlement.
6. Transaction-scoped/JIT liquidity where liquidity is added for a known atomic flow and removed before the transaction ends, subject to protocol rules and measured profitability.

### Class B — zero operator capital, but only after bootstrap profit exists

These create inventory exposure that persists across blocks, venues, or settlement domains. Atomicity cannot make an unresolved position disappear. They can still require **zero operator dollars** by using only SELF_FUNDED retained profit:

1. Resting CEX maker orders.
2. Spot-perpetual/funding strategies held through a funding interval.
3. Long-lived LP positions.
4. Cross-chain relayer/filler inventory. Across explicitly documents that relayers front destination-chain capital and are repaid later because cross-chain intents lack same-transaction atomicity.
5. Any strategy with asynchronous settlement or margin requirements extending past the transaction boundary.

The governing distinction is therefore not “zero-capital strategy vs normal strategy.” It is **atomic bootstrap capital vs internally generated persistent capital**.

## Canonical economics invariant

No opportunity-backed execution may submit unless fresh authoritative evidence proves:

`terminal_expected_output - temporary_principal - flash_fee - venue_fees - measured_slippage - paymaster_erc20_max_charge - builder_or_relayer_payment - safety_epsilon > 0`

Rules:

- `feePayment.maxAmount` is a cost, never a rebate or synthetic saving.
- A receiver's guaranteed `minProfit` must be strictly greater than the hard-capped paymaster ERC-20 charge before submission.
- The profit token must be delivered to the same EIP-7702/smart-account address from which postOp collects payment.
- If the gas-token quote changes above the hard cap, fail before submission.
- If preparation or postOp cannot prove the opportunity-backed invariant, do not silently fall back after an ambiguous submission.
- Terminal balance delta **after** gas-token collection is realized-profit truth.
- No future fee-tier savings, rebates, or expected MEV capture may manufacture current profitability.

## Existing CryptoCrawler pieces to reuse

- Flash-loan receiver and composite receiver infrastructure.
- Aave atomic liquidation executor.
- Balancer-backed 0x atomic round-trip executor.
- Alchemy EIP-7702 Gas Manager signer/submit/status authority.
- Canonical wallet identity: operational profit recipient resolves to the WALLET_PRIVATE_KEY-derived execution address.
- Stage-4 capital provenance lifecycle:
  `ZERO -> ZERO_GAS_EXECUTION_READY -> ATOMIC_EXECUTION_PENDING -> FIRST_PROFIT_VERIFIED -> SELF_FUNDED`.
- Retained-profit accounting and native-gas funding settlement.
- Profit Ladder / canonical resource scheduler for allocation after SELF_FUNDED.

Do not create a second signer, economic verifier, settlement authority, or profit ledger.

## Implementation sequence

### Slice 1 — opportunity-backed gas primitive

Extend the existing Alchemy Gas Manager authority rather than adding another signer:

- estimation-only ERC-20 postOp quote;
- exact `feePayment.maxAmount` extraction;
- `balanceCheck=false` only for opportunity-backed mode;
- hard `maxTokenAmount` below receiver-guaranteed minimum profit;
- final re-prepare and re-check before signing;
- no fallback after submission ambiguity.

Status: source primitive added on this isolated branch. It is not yet a runtime proof that the configured Alchemy policy accepts this mode.

### Slice 2 — atomic DEX wiring

The current Balancer/0x atomic path already borrows USDC and returns profit in USDC to the canonical execution wallet. This is the cleanest first integration because the receiver's `minProfit` is in the same six-decimal USDC base units as the ERC-20 paymaster charge.

Execution must return the actual quoted gas-token charge to terminal accounting; it must not be mislabeled as free sponsored gas.

### Slice 3 — liquidation wiring

For Aave liquidation, use the debt/loan asset as gas token only where the configured paymaster supports it. If unsupported, route the atomic unwind to a supported gas token within the receiver while preserving loan repayment and positive net economics.

### Slice 4 — provenance truth

Expand bootstrap proof semantics from “zero monetary gas” to the stronger economic statement:

- zero external/operator input capital;
- zero external/operator native-gas capital;
- gas either genuinely sponsored or fully paid from opportunity proceeds;
- residual profit verified after all gas-token settlement.

Only then may opportunity-backed execution advance FIRST_PROFIT_VERIFIED -> SELF_FUNDED.

### Slice 5 — persistent-strategy capital router

Once SELF_FUNDED, expose the verified retained balance as the sole bootstrap allocation pool for maker, funding, persistent LP, and cross-chain strategies. Profit Ladder decides sizing; no strategy may pull operator capital.

## Explicitly rejected/deferred paths

- Do not build against legacy Gelato SyncFee/callWithSyncFee; current migration material marks that path deprecated.
- Do not treat historical 0x v3 matching functions as current 0x production APIs.
- Do not call asynchronous cross-chain fills atomic.
- Do not call paymaster gas free. It is either sponsored by a third party or repaid from internally generated proceeds.
- Do not use JIT liquidity to bypass protocol safeguards or manipulate users. Only protocol-permitted, measured, non-manipulative liquidity provision is eligible.

## End state

The operator contributes $0 of trading principal and $0 of native gas.

The first profitable atomic opportunity obtains temporary principal, pays every atomic cost—including gas—from the opportunity settlement/credit layer, and leaves a terminally verified residual. From that point forward, the system is SELF_FUNDED and can allocate retained profits across both atomic and persistent strategies while continuing to route the configured payout share to the terminal wallet.
