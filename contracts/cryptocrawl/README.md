# Cryptocrawl Flash-Loan Receiver

`CryptocrawlBalancerFlashLoanReceiver.sol` is a Balancer V2 flash-loan receiver for atomic, cyclic USDC/USDT arbitrage routes. It does not trade until it is deployed, an owner or operator submits a route, and all application-side live-execution guards are explicitly enabled.

## Compile

```sh
npm run cryptocrawl:receiver:compile
```

The compiler script uses a pinned `solc@0.8.24` through `npx` by default. In CI, set `ZERO_CAPITAL_SOLC_BIN` to a vetted compiler binary and optionally set `ZERO_CAPITAL_SOLC_ARGS`.

## Validate Locally

```sh
npm run cryptocrawl:receiver:validate
```

This is offline and does not connect to a chain or submit transactions. It validates the route planner, receiver calldata builder, and receiver callback-state safeguards.

## Deployment Dry Run

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=arbitrum \
ARBITRUM_RPC_URL=https://... \
WALLET_PRIVATE_KEY=... \
npm run cryptocrawl:receiver:deploy
```

The deploy script is dry-run by default. Broadcasting requires both:

```sh
ZERO_CAPITAL_DEPLOY=true
ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER
```

After a successful deployment, it writes the address to `contracts/cryptocrawl/deployments/<chain>.json`. Do not set `ZERO_CAPITAL_FLASHLOAN_RECEIVER` until the deployed bytecode, constructor values, and contract review are independently verified.

## Configure Receiver Allow Lists

The receiver rejects arbitrary call targets and approval tokens. The configuration script derives the required router and approval-token allowlists from `ZERO_CAPITAL_ROUTE_CONFIG`, then rejects missing or unexpected addresses. Configure only the routers and stablecoins used by your reviewed route configuration:

```sh
ZERO_CAPITAL_DEPLOY_CHAIN=arbitrum \
ARBITRUM_RPC_URL=https://... \
WALLET_PRIVATE_KEY=... \
ZERO_CAPITAL_FLASHLOAN_RECEIVER=0x... \
ZERO_CAPITAL_RECEIVER_CONFIG='{"operators":["0x..."],"targets":["0x..."],"approvalTokens":["0x..."]}' \
npm run cryptocrawl:receiver:configure
```

This is dry-run by default. Broadcasting requires both:

```sh
ZERO_CAPITAL_CONFIGURE_RECEIVER=true
ZERO_CAPITAL_CONFIGURE_RECEIVER_CONFIRMATION=CONFIGURE_FLASHLOAN_RECEIVER
```

The configuration signer must be the receiver owner. An owner multisig should submit equivalent `setOperator`, `setAllowedTarget`, and `setAllowedApprovalToken` transactions directly rather than sharing a signer key.

## Route Configuration

`ZERO_CAPITAL_ROUTE_CONFIG` is a JSON array. Every route must be a cyclic, contiguous USDC/USDT path that ends in the borrowed token. Amounts are integer base units and six-decimal stablecoin accounting is enforced.

```json
[
	{
		"id": "ethereum-usdc-weth-usdc",
		"chain": "ethereum",
		"inputAssetSymbol": "USDC",
		"inputToken": "0x...",
		"inputTokenDecimals": 6,
		"amountIn": "1000000000",
		"estimatedGasCostInInputToken": "200000",
		"relayFeeInInputToken": "100000",
		"flashLoanFeeBps": 0,
		"minNetProfitBps": 50,
		"legs": [
			{ "protocol": "uniswapV3", "tokenIn": "0x...", "tokenOut": "0x...", "feeTier": 500 },
			{ "protocol": "sushiswap", "tokenIn": "0x...", "tokenOut": "0x...", "fee": 0.003 }
		]
	}
]
```

The route quoter queries each configured leg live, rejects non-cyclic or non-profitable paths after configured flash-loan, gas, and relay costs, then applies Cryptara’s live signal, latency, gas, slippage, and governance gates before queueing a candidate.

## Live Execution Gates

The application requires all of these before zero-capital execution starts:

- `NO_EXECUTION` is not `true`
- `CRYPTO_ARBITRAGE_LIVE_EXECUTION=true`
- `CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK`
- `ZERO_CAPITAL_ENABLE_EXECUTION=true`
- `ZERO_CAPITAL_EXECUTION_CONFIRMATION=I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK`
- `ZERO_CAPITAL_FLASHLOAN_RECEIVER` is a deployed receiver address
- Receiver allow lists contain the specific routers and stablecoins used by the configured route
- `WALLET_PRIVATE_KEY`, chain RPC, live TradingView, and live Alchemy are available
- `ZERO_CAPITAL_ROUTE_CONFIG` contains a cyclic USDC/USDT route that clears its fee, gas, and net-profit floor
- `ZERO_CAPITAL_FLASHBOTS_PAYMENT_MODE=external_sponsor`, the matching sponsor address, and an explicit sponsor confirmation are set for the currently supported live path

Recommended conservative runtime settings:

```sh
ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS=9990
ZERO_CAPITAL_MAX_SLIPPAGE_BPS=20
ZERO_CAPITAL_MAX_GAS_GWEI=60
ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS=1000
ZERO_CAPITAL_SIGNAL_RECHECK_MS=5000
ZERO_CAPITAL_FLASHBOTS_FEE_BUFFER_BPS=12000
ZERO_CAPITAL_FLASHBOTS_MAX_FEE_GWEI=60
ZERO_CAPITAL_FLASHBOTS_PRIORITY_FEE_GWEI=1
ZERO_CAPITAL_FLASHBOTS_MAX_PRIORITY_FEE_GWEI=3
ZERO_CAPITAL_FLASHBOTS_WAIT_TIMEOUT_MS=45000
ZERO_CAPITAL_FLASHBOTS_PAYMENT_MODE=external_sponsor
ZERO_CAPITAL_FLASHBOTS_SPONSOR_ADDRESS=0x...
ZERO_CAPITAL_FLASHBOTS_SPONSOR_CONFIRMATION=I_CONFIRM_EXTERNAL_FLASHBOTS_GAS_SPONSOR
```

The receiver and planner are deployable, but the currently supported live path is explicitly **external-sponsor funded**, not strictly zero-capital. Direct submissions on other chains require native gas and are deliberately blocked until a dedicated, reviewed gas-sponsorship adapter exists. Do not describe a deployment as zero-capital-ready until a true profit-share or gas-sponsorship payment adapter has been implemented, tested on a fork or testnet, and verified with an included receiver event.

The receiver enforces repayment plus `minProfit` atomically. A route failure or insufficient final balance reverts the transaction.