# CryptoCrawler Flash-Loan Receivers

CryptoCrawler has two receiver paths:

- `CryptocrawlBalancerFlashLoanReceiver.sol` for the legacy paid-chain route configuration.
- `CryptocrawlSushiV3FlashReceiver.sol` for the SKALE Europa zero-monetary-gas bootstrap path.

Neither receiver trades merely because it is compiled. Live execution remains behind the application governance and explicit live-risk confirmations.

## Compile and Verify

```sh
npm run cryptocrawl:receiver:compile
npm run cryptocrawl:sushi-v3-receiver:compile
npm run cryptocrawl:stage4:verify
```

The compiler is pinned to `solc@0.8.24` through `npx` by default. A vetted compiler can be supplied with `ZERO_CAPITAL_SOLC_BIN` and `ZERO_CAPITAL_SOLC_ARGS`.

## Europa Production Receiver

The production zero-capital bootstrap path uses the Sushi V3 receiver on SKALE Europa. The reviewed infrastructure addresses are built into `europa-sushi-registry.ts`; the receiver constructor is bound to the verified Sushi V3 factory and the canonical execution wallet is the owner.

For Europa, the deployment script defaults `ZERO_CAPITAL_DEPLOY_RECEIVER` to `sushi-v3`. Both receiver deployment and receiver allow-list configuration use the same SKALE external-gas PoW path as live Europa execution. The provisioning helper verifies the Europa chain ID, obtains the current external-gas difficulty, obtains a bounded PoW solution through the Stage 4 compute coordinator, signs the transaction with that PoW gas price, verifies the receipt, and rejects the transaction if the wallet's native balance changes.

### 1. Dry-run the deployment

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=europa \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:deploy
```

`EUROPA_RPC_URL` is optional because the reviewed public Europa RPC is built in. `ZERO_CAPITAL_DEPLOY_OWNER` may be omitted; for Europa it must resolve to the canonical `WALLET_PRIVATE_KEY` address.

### 2. Broadcast the zero-gas deployment

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=europa \
ZERO_CAPITAL_DEPLOY_RECEIVER=sushi-v3 \
ZERO_CAPITAL_DEPLOY=true \
ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:deploy
```

The successful deployment writes `contracts/cryptocrawl/deployments/europa.json` and prints two values that must come from the actual on-chain receipt and bytecode:

```text
ZERO_CAPITAL_EUROPA_RECEIVER=<deployed contract address>
ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=<keccak256 of deployed bytecode>
```

Do not invent either value. The runtime independently fetches the deployed code, recomputes the hash, and verifies that the receiver is bound to the expected Sushi V3 factory.

### 3. Configure the Europa receiver allow lists

Set the two deployment values above, then dry-run:

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=europa \
ZERO_CAPITAL_EUROPA_RECEIVER=0x... \
ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=0x... \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:configure
```

For Europa, the configurator does **not** depend on `ZERO_CAPITAL_ROUTE_CONFIG`. The bootstrap routes are discovered dynamically, so the configurator derives the exact allow list from the reviewed Europa registry:

- Target: the verified Sushi Route Processor.
- Approval tokens: Europa USDC, SKL, and ETH used by the two validated triangular cycles.
- Operators: none are required because the canonical execution wallet owns the receiver.

The script verifies the receiver code hash, owner, and Sushi V3 factory before proposing any write. Existing allow-list entries are detected and skipped.

Broadcast configuration with:

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=europa \
ZERO_CAPITAL_EUROPA_RECEIVER=0x... \
ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=0x... \
ZERO_CAPITAL_CONFIGURE_RECEIVER=true \
ZERO_CAPITAL_CONFIGURE_RECEIVER_CONFIRMATION=CONFIGURE_FLASHLOAN_RECEIVER \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:configure
```

Each Europa configuration transaction is submitted through the zero-monetary-gas PoW provisioning helper and the script verifies every required mapping after confirmation.

## Europa PoW Compute Requirements

`EUROPA_EXTERNAL_GAS_DIFFICULTY` is required only when the available Europa RPC endpoints do not expose `debug_getConfig` or `skale_getConfig`.

The Stage 4 compute coordinator uses this hierarchy:

1. configured zero-dollar remote compute providers;
2. local Beam when the runtime is explicitly verified free;
3. bounded Railway emergency compute while native-gas bootstrap/recovery is active.

When Railway emergency compute is enabled, configure its existing budget governor variables rather than bypassing the governor. Receiver provisioning is infrastructure work, but it remains inside the same bounded bootstrap/recovery compute policy.

## Runtime Europa Gates

The live Europa zero-capital path requires, among the other governance checks:

```text
NO_EXECUTION != true
CRYPTO_ARBITRAGE_LIVE_EXECUTION=true
CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK
ZERO_CAPITAL_ENABLE_EXECUTION=true
ZERO_CAPITAL_EXECUTION_CONFIRMATION=I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK
ZERO_CAPITAL_EUROPA_EXECUTION_CONFIRMATION=I_ACCEPT_EUROPA_ZERO_GAS_EXECUTION_RISK
ZERO_CAPITAL_EUROPA_RECEIVER=<verified deployed address>
ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=<verified deployed code hash>
ZERO_CAPITAL_ZEROX_API_KEY=<0x API key>
WALLET_PRIVATE_KEY=<canonical execution wallet key>
```

The engine separately verifies Europa/Arbitrum connectivity, receiver bytecode and factory identity, SKALE PoW difficulty, capital provenance, live market gates, source-funded Meson settlement, 0x Gasless conversion, destination transaction receipts, and the destination native-balance increase.

## Legacy Paid-Chain Receiver

For Ethereum, Polygon, Arbitrum, or Optimism, the deployment script continues to support the Balancer receiver. These paths use `ZERO_CAPITAL_FLASHLOAN_RECEIVER` and `ZERO_CAPITAL_RECEIVER_CONFIG` and retain their existing paid-chain/sponsorship requirements. They are not a substitute for the Europa zero-monetary-gas bootstrap path.

A legacy deployment dry run is:

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=arbitrum \
ARBITRUM_RPC_URL=https://... \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:deploy
```

Broadcasting still requires:

```text
ZERO_CAPITAL_DEPLOY=true
ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER
```

Legacy allow-list configuration still derives the exact routers and approval tokens from `ZERO_CAPITAL_ROUTE_CONFIG` and rejects missing or unexpected addresses.
