# 🎯 Arbitrage Automation - Quick Start

## One Command to Rule Them All

```bash
# DRY RUN (safe, no real money) - DEFAULT
npm run arbitrage

# LIVE RUN (real money, requires 10s confirmation)
npm run arbitrage -- --live

# CONSISTENCY TESTS
npm run arbitrage:test
```

## What You Get

### ✅ Real Arbitrage
- **Real prices** from Uniswap V3, SushiSwap, PancakeSwap
- **Real costs**: trading fees + gas + slippage + bridge
- **Real profit**: only executes if net profit > 0

### ✅ Clean Execution Path
```
Scan → Calculate → Execute → Wallet
```
No unnecessary layers, no complexity.

### ✅ Safety First
- **Dry run by default** - no real money
- **10-second confirmation** for live mode
- **Never executes** if costs > profit
- **AES-256 encryption** for wallet keys

## Configuration

```bash
# Set trading pair (default: ETH/USDC)
export ARB_PAIR="BNB/BUSD"

# Set trade size (default: $10,000)
export ARB_TRADE_SIZE="5000"

# Set max cycles (default: 10)
export ARB_MAX_CYCLES="20"

# Run with custom config
ARB_PAIR=BNB/BUSD ARB_TRADE_SIZE=5000 npm run arbitrage
```

## Expected Output

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
════════════════════════════════════════════════════════════════════

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

📈 Statistics:
   Success Rate: 100.0%
   Total Profit: $59.23
   Avg Time: 142ms

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

## Consistency Tests

```bash
npm run arbitrage:test
```

Runs 6 tests to verify:
1. ✅ Price feeds are real and accurate
2. ✅ Cost calculations are correct
3. ✅ Opportunity detection works
4. ✅ Execution path is direct
5. ✅ Multi-cycle consistency (5 cycles)
6. ✅ Wallet integration is secure

## Files

| File | Purpose |
|------|---------|
| `server/services/cryptocrawl/arbitrage-automation.ts` | Main automation system |
| `server/services/cryptocrawl/run-arbitrage.ts` | CLI runner |
| `server/services/cryptocrawl/test-arbitrage-consistency.ts` | Test suite |
| `STAGE_TWO_ARBITRAGE_AUTOMATION.md` | Full documentation |

## Safety Checklist

Before running live mode:

- [ ] Run dry-run cycles: `npm run arbitrage`
- [ ] Run consistency tests: `npm run arbitrage:test`
- [ ] Verify all tests pass
- [ ] Check wallet has funds
- [ ] Set appropriate trade size
- [ ] Understand you're using REAL MONEY

## Environment Setup (Optional)

```bash
# Default RPC endpoints are provided, but you can override:
export ETHEREUM_RPC="https://your-ethereum-rpc"
export BSC_RPC="https://your-bsc-rpc"
export POLYGON_RPC="https://your-polygon-rpc"

# Wallet encryption password (default: CRYPTOCRAWL)
export WALLET_ENCRYPTION_PASSWORD="your-secure-password"
```

## Stop Execution

Press `Ctrl+C` at any time to stop gracefully.

---

**Status**: ✅ STAGE TWO COMPLETE - READY FOR TESTING
