# CryptoCrawler Ghost Wallet + External Capital Fabric

## Purpose

Ghost Wallet is a separate borrower-initiated on-chain credit-intermediation lane. It is not a CryptoCrawler arbitrage topology and is not governed by the arbitrage Profit Ladder or exchange schedule.

A successful Ghost Wallet transaction has one hard economic invariant:

`principal delivered -> borrower callback -> principal + quoted fee restored -> source debt neutralized where applicable -> realized surplus paid to canonical primary wallet -> transaction returns success`

If repayment, callback validation, or delegated-debt neutrality fails, the transaction reverts atomically.

The off-chain `ghost-wallet-engine.ts` is observability only. It never submits a borrower transaction and never treats configuration as proof that capital exists.

## Contract

`contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol`

Two funding modes are implemented:

1. **Balance-backed ERC-3156-compatible intermediation** — the contract lends enabled ERC-20 liquidity already present at the contract. Principal plus fee must be restored in the same transaction. Realized surplus above the starting principal balance is transferred immediately to `profitRecipient`.
2. **Aave-style delegated-credit intermediation** — a third-party delegator explicitly grants variable-debt borrowing allowance to the Ghost Wallet contract. The contract borrows against the delegator's collateral, lends the asset to the atomic borrower, collects principal plus fee, repays the delegated debt in the same transaction, verifies that the delegator's variable-debt balance did not increase, and pays realized surplus immediately to `profitRecipient`.

The contract includes owner controls, pause, reentrancy protection, explicit asset policies, safe ERC-20 calls, and paused-only emergency recovery.

## Profit isolation

Ghost Wallet profits do not enter retained-profit accounting or the arbitrage Profit Ladder. The deployed contract's `profitRecipient` must match the canonical primary payout address derived from the execution wallet identity. The runtime observer marks a configured contract ready only when deployed bytecode exists, the contract is unpaused, and that recipient matches.

## Five additional capital primitives

`external-capital-capability-registry.ts` and `zero-capital-capital-fabric.ts` represent five additional no-key/no-signup capital classes without fabricating capacity:

### 1. Euler debt assumption

Euler's position-transfer liquidation model can move selected debt to a liquidator together with discounted collateral, so the full repayment asset need not be supplied upfront. In CryptoCrawler this is a **principal-offset** mechanism, not generic borrowed cash. It is usable only after exact position health, debt, collateral, unwind liquidity, gas and settlement economics are measured.

Reference: https://docs.euler.finance/learn/liquidations/

### 2. Aave credit delegation

A third-party delegator can grant borrowing allowance backed by the delegator's collateral. In Ghost Wallet's atomic implementation, this may supply temporary principal only when delegation, pool capacity and debt-token behavior are proven, and the resulting delegated debt is fully neutralized before transaction completion.

Reference: https://aave.com/docs/developers/smart-contracts/tokenization

### 3. Signed-intent principal

EIP-712 typed signed intents can authorize exact economic terms without a centralized account or API key. A live intent is not counted as capital until signature, domain, chain, nonce, deadline, token authorization, amount and minimum-output terms have all been verified. Replay protection is application-owned and mandatory.

Reference: https://eips.ethereum.org/EIPS/eip-712

### 4. Multilateral netting / Coincidence of Wants

Complementary signed demands can cancel gross principal requirements. CryptoCrawler counts only the exact same-asset matched amount as **principal offset**; any unmatched delta still needs an independently proven source. This is the capital-efficiency mechanism demonstrated by Coincidence-of-Wants designs, not synthetic liquidity.

Reference: https://docs.cow.fi/

### 5. ERC-4626-compatible strategy vault credit

ERC-4626 standardizes tokenized vault shares, but ERC-4626 by itself does **not** grant a strategy permission to borrow depositor assets. CryptoCrawler therefore does not label an arbitrary ERC-4626 vault as credit. A compatible vault must expose and prove a separate strategy/credit draw-and-return authority, and its share accounting must address known empty-vault/donation inflation risks.

References:
- https://eips.ethereum.org/EIPS/eip-4626
- https://docs.openzeppelin.com/contracts/5.x/erc4626

## Additional protocol-native transient settlement

Research also identified a sixth useful capital-efficiency class: protocol-native transient accounting. Systems such as Uniswap v4 and Balancer v3 can allow value to be taken/used during an unlocked transaction while tracking net deltas that must settle before the transaction finishes. CryptoCrawler classifies this separately from a flash-loan provider and keeps it fail-closed until an exact route-specific adapter is verified.

References:
- https://docs.uniswap.org/contracts/v4/concepts/flash-accounting
- https://docs.balancer.fi/concepts/vault/transient-accounting.html

## Capital fabric admission

`composeZeroCapitalFabricPlan()` operates on exact token base units. It may combine measured **principal offsets** and **principal supplies** dynamically, preferring offsets and then lower measured cost. It cannot submit transactions or move capital.

A plan is executable only when:

- the entire exact base-unit requirement is covered;
- every selected capability is fresh and explicitly `executionReady`;
- every selected capability delegates movement to an exact canonical adapter;
- no selected bootstrap source requires operator/system-owned principal or operator collateral;
- no selected bootstrap source depends on an API key or account signup;
- asset identity matches exactly;
- same-transaction debt-neutrality requirements are satisfied where requested; and
- the weighted measured cost is within the caller's economic boundary.

Seeded research capabilities intentionally start `executionReady: false`. Configuration, a protocol name, a wallet balance, or a theoretical mechanism never becomes capital evidence by itself.

## Deployment

Compile using the existing pinned Solidity compiler path:

`npm run cryptocrawl:receiver:compile`

The compiler now includes `CryptocrawlGhostWalletIntermediary.sol`.

A guarded deployment entrypoint is available:

`npx tsx scripts/cryptocrawl/deploy-ghost-wallet-intermediary.ts`

Required deployment state:

- `WALLET_PRIVATE_KEY` — existing canonical execution signer.
- `GHOST_WALLET_DEPLOY_CHAIN` — ethereum, polygon, arbitrum, optimism, bsc, or avalanche.
- An existing chain RPC variable, or optional `GHOST_WALLET_DEPLOY_RPC_URL`.

The command is dry-run by default. Broadcasting additionally requires both:

- `GHOST_WALLET_DEPLOY=true`
- `GHOST_WALLET_DEPLOY_CONFIRMATION=DEPLOY_GHOST_WALLET_INTERMEDIARY`

After verified deployment, configure the runtime observer with:

`GHOST_WALLET_INTERMEDIARY_<CHAIN>=<deployed address>`

Optional observed assets are comma-separated token addresses:

`GHOST_WALLET_ASSETS_<CHAIN>=<token1>,<token2>`

The runtime observer never assumes those asset addresses are enabled or liquid; it calls the deployed contract to measure them.

## External standards reviewed

- ERC-3156 atomic lender/borrower callback and repayment semantics: https://eips.ethereum.org/EIPS/eip-3156
- EIP-712 typed structured data/signature domain semantics and replay warning: https://eips.ethereum.org/EIPS/eip-712
- Euler liquidation position/debt transfer: https://docs.euler.finance/learn/liquidations/
- CoW Protocol Coincidence of Wants: https://docs.cow.fi/
- ERC-4626 vault interface and OpenZeppelin inflation-attack guidance: https://eips.ethereum.org/EIPS/eip-4626 and https://docs.openzeppelin.com/contracts/5.x/erc4626
