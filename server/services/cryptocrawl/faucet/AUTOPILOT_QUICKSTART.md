# Arbitrage Auto-Pilot - Quick Start

## Stage Two: Clean Profit Flow

The Auto-Pilot is designed to be **clean and efficient**:

1. **Verify arbitrage is real** (prices, fees, bridges align)
2. **Confirm execution path → wallet** is correct
3. **Run small, controlled live cycles** to prove consistency
4. **Nothing else** - pure profit flow

---

## Quick Start

### 1. Set Target Wallet

```typescript
import { arbitrageAutopilot } from './server/services/cryptocrawl/faucet';

// Set your wallet (REQUIRED before any execution)
arbitrageAutopilot.setTargetWallet('0xYourWalletAddress...');
```

### 2. Configure (Optional)

```typescript
arbitrageAutopilot.configure({
  minProfitUsd: 5,        // Minimum $5 profit per trade
  maxGasCostUsd: 2,       // Max $2 gas
  tradeSizeUsd: 100,      // $100 controlled trades
  minPriceConfidence: 0.85, // 85% price confidence required
});
```

### 3. Run Single Cycle

```typescript
// Run one controlled cycle
const report = await arbitrageAutopilot.runControlledCycle();

console.log('Cycle Report:', {
  opportunities: report.validOpportunities,
  executed: report.executed,
  profit: report.totalProfit,
  walletBalance: report.walletBalance,
});
```

### 4. Start Auto-Pilot (Continuous)

```typescript
// Start continuous operation (60s intervals)
await arbitrageAutopilot.startAutopilot(60000);

// Stop when done
arbitrageAutopilot.stopAutopilot();
```

---

## Command Line Test

```bash
# Set wallet and run test
export TARGET_WALLET="0xYourWalletAddress"
export TEST_CYCLES=3

npx ts-node server/services/cryptocrawl/faucet/run-autopilot-test.ts
```

---

## Core Functions

| Function | Purpose |
|----------|---------|
| `setTargetWallet(addr)` | Set profit destination (required) |
| `configure(config)` | Update settings |
| `verifyArbitrage(asset, buy, sell)` | Check if arb is real |
| `verifyWalletFlow()` | Confirm wallet path |
| `runControlledCycle()` | Run one safe cycle |
| `startAutopilot(interval)` | Continuous operation |
| `stopAutopilot()` | Stop auto-pilot |
| `healthCheck()` | System health status |
| `getStatus()` | Current metrics |

---

## What Gets Verified

### Price Verification
- Multi-oracle consensus (Chainlink, Uniswap TWAP, Pyth, DEX spot)
- Manipulation detection
- Honeypot probability check
- Minimum confidence threshold

### Cost Verification
- Real-time gas costs per chain
- Bridge fees (if cross-chain)
- Slippage estimation
- Net profit calculation

### Wallet Verification
- Address integrity check
- Balance confirmation
- Execution path trace

---

## Safety Features

- **Minimum profit threshold** - No trades below threshold
- **Maximum gas limit** - Never overpay for gas
- **Price confidence** - Oracle consensus required
- **Wallet verification** - Checked before every execution
- **Controlled trade size** - Small, predictable amounts
- **Single execution per cycle** - No runaway trades

---

## Output Example

```
🔄 Starting controlled cycle: cycle_1_1702550400000
   Trade size: $100
   Min profit: $5

🔐 Verifying wallet flow...
✅ Wallet verified: 0x1234abcd...
   Balance: $523.45

🔍 Verifying arbitrage: ETH polygon→arbitrum
✅ Valid arbitrage found
   Spread: 0.125%
   Net profit: $6.24
   Confidence: 91.2%

⚡ Executing: arb_1702550401234_abc123

📈 Cycle Complete: cycle_1_1702550400000
   Scanned: 24
   Valid: 3
   Executed: 1
   Successful: 1
   Profit: $5.89
   Duration: 2340ms
```

---

## Architecture

```
┌─────────────────────────────────────┐
│       ArbitrageAutopilot            │
├─────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐   │
│  │ Price       │  │ Wallet      │   │
│  │ Validator   │  │ Verifier    │   │
│  └──────┬──────┘  └──────┬──────┘   │
│         │                │          │
│         ▼                ▼          │
│  ┌─────────────────────────────┐    │
│  │    Opportunity Scanner      │    │
│  └──────────────┬──────────────┘    │
│                 │                   │
│                 ▼                   │
│  ┌─────────────────────────────┐    │
│  │     Execution Engine        │    │
│  └──────────────┬──────────────┘    │
│                 │                   │
│                 ▼                   │
│  ┌─────────────────────────────┐    │
│  │     Target Wallet           │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Pure profit flow - nothing else.
