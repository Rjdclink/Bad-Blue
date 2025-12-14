# Stage Two: Clean Arbitrage Automation

## 🎯 What This Is

Real arbitrage automation with:
- Real prices from on-chain sources
- Accurate cost calculations
- Direct execution to wallet
- Zero unnecessary complexity

## 🚀 Quick Start

```bash
# Dry run (safe, no real money)
npm run arbitrage

# Consistency tests
npm run arbitrage:test

# Live mode (real money, requires confirmation)
npm run arbitrage -- --live
```

## 📁 Files

### **Main System**
- `arbitrage-automation.ts` - Complete automation system (ONE FILE)
  - `RealPriceFeed` - Real prices from Uniswap V3, SushiSwap, PancakeSwap
  - `RealCostCalculator` - Trading fees, gas, slippage, bridge costs
  - `ArbitrageDetector` - Find profitable opportunities
  - `ArbitrageExecutor` - Execute trades to wallet
  - `AutomatedArbitrageController` - Orchestrate everything

### **Runners**
- `run-arbitrage.ts` - CLI runner with safety features
- `test-arbitrage-consistency.ts` - Consistency test suite

### **Documentation**
- `README_STAGE_TWO.md` - This file
- See root directory for full documentation:
  - `STAGE_TWO_COMPLETE.md`
  - `ARBITRAGE_QUICK_START.md`
  - `STAGE_TWO_VISUAL_SUMMARY.md`

## ✅ What Makes This Real Arbitrage

### 1. Real Prices (Not Random)
```typescript
// OLD - FAKE:
const price = 1 + Math.random() * 0.1; ❌

// NEW - REAL:
const quoter = new ethers.Contract(QUOTER_ADDRESS, quoterABI, provider);
const quote = await quoter.callStatic.quoteExactInputSingle({
  tokenIn: WETH,
  tokenOut: USDC,
  amountIn,
  fee,
  sqrtPriceLimitX96: 0
}); ✅
```

### 2. Accurate Costs
- **Trading fees**: Actual exchange fees (0.25%-0.3%)
- **Gas cost**: Real-time from `eth_gasPrice`
- **Slippage**: Calculated from liquidity depth
- **Bridge cost**: Actual fees per chain

### 3. Direct Execution Path
```
Scan → Calculate → Execute → Wallet
```
No intermediate layers, no abstraction overhead.

### 4. Only Execute if Profitable
```typescript
if (netProfit > 0 && confidence > 0.75) {
  execute();
}
```

## 📊 Configuration

```bash
# Environment variables
export ARB_PAIR="ETH/USDC"          # Trading pair
export ARB_TRADE_SIZE="10000"       # Trade size in USD
export ARB_MAX_CYCLES="10"          # Max cycles to run

# Optional RPC endpoints (defaults provided)
export ETHEREUM_RPC="https://..."
export BSC_RPC="https://..."
export POLYGON_RPC="https://..."

# Wallet encryption (default: CRYPTOCRAWL)
export WALLET_ENCRYPTION_PASSWORD="your-password"
```

## 🧪 Testing

### Consistency Tests
```bash
npm run arbitrage:test
```

Tests verify:
1. ✅ Price feeds are real and accurate
2. ✅ Cost calculations are correct
3. ✅ Opportunity detection works
4. ✅ Execution path is direct
5. ✅ Multi-cycle consistency (5 cycles, 95%+ success)
6. ✅ Wallet integration is secure

### Dry Run
```bash
npm run arbitrage
```

Runs 10 cycles safely without real money to verify:
- Success rate consistency
- Profit calculations
- Execution timing
- Error handling

## 🔒 Safety

1. **Dry run by default** - No real transactions unless `--live` flag
2. **10-second confirmation** - Time to cancel before live execution
3. **Cost protection** - Never executes if costs > profit
4. **Slippage protection** - Max 1% slippage tolerance
5. **Wallet encryption** - AES-256-CBC for private keys
6. **Graceful shutdown** - Ctrl+C stops safely

## 📈 Expected Output

```
════════════════════════════════════════════════════════════════════
🎯 AUTOMATED ARBITRAGE CONTROLLER - STAGE TWO
════════════════════════════════════════════════════════════════════

Configuration:
  Pair: ETH/USDC
  Trade Size: $10,000
  Max Cycles: 10
  Mode: 🟢 DRY RUN (SAFE)

════════════════════════════════════════════════════════════════════

CYCLE 1/10

🔍 Scanning for real arbitrage opportunities
✅ Found 2 opportunities

📊 Best opportunity:
  buyExchange: uniswap-v3
  sellExchange: sushiswap
  spread: 1.23%
  grossProfit: $123.00
  costs: $65.00
  netProfit: $58.00
  confidence: 87.5%

⚡ Executing...
✅ Completed in 142ms
   Profit: $59.23

[... more cycles ...]

════════════════════════════════════════════════════════════════════
🏁 FINAL REPORT
════════════════════════════════════════════════════════════════════
Total Cycles: 10
Success Rate: 95.0%
Total Profit: $587.45
Avg Profit/Trade: $61.83
════════════════════════════════════════════════════════════════════
```

## 🛠️ Implementation Details

### Price Feed Sources
1. **Uniswap V3** - Quoter contract for accurate quotes
2. **SushiSwap** - Router contract for swap amounts
3. **PancakeSwap** - BSC router for cross-chain opportunities

### Cost Calculation
```typescript
totalCost = tradingFees + gasCost + slippageCost + bridgeCost

where:
  tradingFees = (tradeSize × buyFee) + (tradeSize × sellFee)
  gasCost = (gasPrice × gasLimit × ethPrice) / 1e18
  slippageCost = tradeSize × (tradeSize / liquidity)^1.5
  bridgeCost = baseFee + (amount × 0.001)
```

### Execution Strategy
1. Query real prices from all DEXs
2. Calculate all costs accurately
3. Find net profit (gross - costs)
4. Only execute if net profit > 0
5. Verify profit landed in wallet

## 🔄 Removed Complexity

Previously had 5,000+ lines of code including:
- ❌ Stealth mode
- ❌ Babel translation
- ❌ Cain reasoning
- ❌ Tower of Babel
- ❌ Light language
- ❌ Security proofs
- ❌ Threat monitoring
- ❌ 18 trading windows
- ❌ Exchange distribution
- ❌ Daily targets

**None of this was needed for profit.**

Now have 1,000 lines of focused code:
- ✅ Real price feeds
- ✅ Cost calculations
- ✅ Arbitrage detection
- ✅ Direct execution
- ✅ Wallet management

## 📞 Support

For issues or questions:
1. Check documentation in root directory
2. Run consistency tests: `npm run arbitrage:test`
3. Review logs in console output

## ✅ Status

**Stage Two Complete** - Ready for controlled testing

Run `npm run arbitrage` to start.
