# Canonical Cursor Instruction Set — Crypto Arbitrage Verification

## Global Non-Negotiable Rules

| # | Rule |
|---|------|
| 1 | Profit-only capital (zero external capital) |
| 2 | Auto-pause is absolute; any anomaly pauses immediately |
| 3 | No silent scope expansion; every increase requires explicit UNPAUSE |
| 4 | All changes reversible within one cycle |
| 5 | Human veto and kill-switch always available |
| 6 | Exposure target ≈ 6% (accepted), never unbounded |

---

## Agent 1 — Configuration & Safety Gate Verifier

### Checks Performed
| Check | Critical | Description |
|-------|----------|-------------|
| Bridge Wallet Address | ✓ | Env var `BRIDGE_WALLET_ADDRESS` exists and is non-empty |
| Bridge Wallet Private Key | ✓ | Env var `PRIVATE_KEY` or `BRIDGE_WALLET_PRIVATE_KEY` exists |
| Profit Wallet Address | ✓ | Env var `CRYPTO_PAYOUT_WALLET_ADDRESS` exists |
| Active RPC Endpoint | ✓ | At least one RPC configured (Alchemy or chain-specific) |
| Signer Matches Bridge | ✓ | Private key cryptographically derives bridge wallet address |
| Faucet/Capital Caps | ✓ | Capital caps are enabled |
| Evolution Lock | ✓ | Evolution lock is ON |
| Auto-Pause | ✓ | Auto-pause is ON |
| Kill-Switch Reachable | ✓ | Global kill-switch is armed and reachable |
| Profit-Only Reinvestment | ✓ | Only profits can be reinvested |

### Deliverable
```
Written confirmation: All secrets, caps, locks, and profit-only rules are ACTIVE
```

### Required Environment Variables
```bash
# REQUIRED for Agent 1 to pass
BRIDGE_WALLET_ADDRESS=0x...        # Bridge wallet for cross-chain ops
PRIVATE_KEY=...                     # OR BRIDGE_WALLET_PRIVATE_KEY
CRYPTO_PAYOUT_WALLET_ADDRESS=0x... # Profit destination wallet
ALCHEMY_API_KEY=...                # OR chain-specific RPC URLs
```

---

## Agent 2 — Chain & Bridge Wiring Validator

### Checks Performed
| Check | Critical | Description |
|-------|----------|-------------|
| Chain Mapping: polygon | | Chain ID 137 with risk params |
| Chain Mapping: arbitrum | | Chain ID 42161 with risk params |
| Chain Mapping: bsc | | Chain ID 56 with risk params |
| Chain Mapping: avalanche | | Chain ID 43114 with risk params |
| At Least One Chain | ✓ | Minimum one chain configured |
| Signer From Env | ✓ | Signer loaded from environment variable |
| Hard-Fail on Missing Signer | ✓ | System will hard-fail if signer missing |
| Per-Chain Risk Parameters | ✓ | All chains have fees, latency, slippage configured |

### Deliverable
```
Confirmation: Signer-based authorization and per-chain risk configs are WIRED
```

### Per-Chain Risk Configuration
| Chain | Max Slippage | Latency Tolerance | Max Fees | Max Position |
|-------|--------------|-------------------|----------|--------------|
| polygon | 2.0% | 300ms | $5 | $5,000 |
| arbitrum | 1.5% | 200ms | $10 | $10,000 |
| bsc | 2.5% | 350ms | $3 | $3,000 |
| avalanche | 2.0% | 400ms | $8 | $8,000 |

---

## Agent 3 — Arbitrage Signal Detection Test

### Process
1. Run one constrained live cycle (automatic scanning)
2. Scan configured chains for arbitrage opportunities
3. Validate fee/slippage/latency constraints
4. Submit to risk governor for approval/rejection
5. Record confidence score and volatility regime

### Checks Performed
| Check | Critical | Description |
|-------|----------|-------------|
| Market Scan Initiated | ✓ | Scan started across configured venues |
| Signal Detection | ✓ | Arbitrage signal identified |
| Fee Validation | ✓ | Fees within chain limits |
| Slippage Validation | ✓ | Slippage within chain limits |
| Latency Validation | ✓ | Latency within chain limits |
| Risk Governor Decision | ✓ | Signal approved OR correctly rejected |
| Signal Confidence | ✓ | Confidence score recorded (>0) |
| Volatility Regime | ✓ | Market regime classified |

### Deliverable
```
Log evidence of accepted or correctly rejected signals:
  - Signal ID: sig-{timestamp}-{randomhex}
  - Market scan → signal detection
  - Fee/slippage/latency validation
  - Risk governor approval or correct rejection
  - Confidence score recorded
  - Volatility regime classification
```

---

## Agent 4 — Execution & Profit Routing Test

### Checks (If Valid Signal Executes)
| Check | Critical | Description |
|-------|----------|-------------|
| Trade Executed | ✓ | Trade executes without manual input |
| Profit Routing | ✓ | Profits route only to profit wallet |
| No Alternate Destinations | ✓ | No other destinations possible |
| Net Profit Recorded | ✓ | Net profit after fees logged |
| Slippage Logged | ✓ | Actual vs expected slippage recorded |

### Deliverable
```
Proof of execution + verified routing + cost realism:
  - Execution ID: exec-{timestamp}-{randomhex}
  - Trade executed automatically (or correctly skipped)
  - Profits routed ONLY to configured profit wallet
  - Net profit: ${amount} (expected: ${amount})
  - Slippage: {actual}% vs expected {expected}%
```

---

## Agent 5 — Automation, Auto-Pause, and Mode Control

### Prerequisites
- Agent 1 must pass
- Agent 2 must pass
- Agent 3 must pass
- Agent 4 must pass

### Checks Performed
| Check | Critical | Description |
|-------|----------|-------------|
| Prerequisites | ✓ | All Agents 1-4 passed |
| Auto-Pause After Cycle | ✓ | System pauses after each cycle |
| Auto-Pause On Anomaly | ✓ | System pauses on any anomaly |
| Arbitrage Mode Set | ✓ | Mode set to AUTOMATIC (if prerequisites met) |
| Mode Persistence | ✓ | Mode persists across restarts |
| Automatic Mode Governance | ✓ | Respects caps, cooldowns, pause rules |

### Deliverable
```
Confirmation: Automatic mode is ENABLED and governed
  - Mode: AUTOMATIC
  - Auto-pause: ACTIVE
  - Caps respected: YES
```

---

## Agent 6 — Safe Scaling & Profit-Ladder Governor (Accelerated)

### Profit Ladder
| Tier | Daily Target | Parallel Routes | Venues | Pairs | Cycles Required |
|------|--------------|-----------------|--------|-------|-----------------|
| 1 | $200 | 1 | 2 | 4 | 3 |
| 2 | $400 | 2 | 4 | 6 | 3 |
| 3 | $800 | 3 | 6 | 8 | 3 |
| 4 | $1,600 | 4 | 8 | 10 | 3 |
| 5 | $3,200 | 5 | 10 | 12 | 3 |
| 6 | $6,400 | 6 | 12 | 14 | 3 |
| 7 | $12,800 | 7 | 14 | 16 | 3 |
| 8 | $25,000 | 8 | 16 | 18 | 3 |
| 9 | $35,000 | 9 | 18 | 20 | 3 |

### Promotion Rules (Accelerated, Exposure ≈6%)
- ≥3 consecutive profitable cycles per tier
- No anomaly; slippage/latency within bounds
- Drawdown below 10% threshold
- Signal confidence average above 70%
- Volatility regime acceptable (low/normal)

### Scaling Mechanics (Order Matters)
1. **Increase frequency** (+1 parallel route per tier)
2. **Widen venue breadth** (unlock two venues per promotion)
3. **Widen pair breadth**
4. **Increase position sizing** (LAST)

### Cooldowns & Caps
- Cooldowns shortened 30% (still mandatory)
- Per-venue volume caps retained with +10% headroom after clean cycles
- Profit transfers batched more frequently but capped and staggered

### Controls
- Human UNPAUSE required for each tier increase
- Automatic re-lock on variance spikes or boundary pressure

### Deliverable
```
Written confirmation: Ladder logic, promotion gates, and controls are ENFORCED

PROFIT LADDER STATUS:
  Tier 1: $200/day - ✓ UNLOCKED (0/3 cycles)
  Tier 2: $400/day - ○ LOCKED (0/3 cycles)
  ...
  Tier 9: $35,000/day - ○ LOCKED (0/3 cycles)

CONTROLS:
  • Human UNPAUSE required for each tier increase
  • Automatic re-lock on variance spikes
  • Exposure target: 6% (never unbounded)
  • Scaling order: Frequency → Venues → Pairs → Position size
```

---

## Final Acceptance Criteria

| Criterion | Requirement |
|-----------|-------------|
| End-to-end automation | All 6 agents pass |
| Correct profit routing | Profit wallet configured |
| Reliable auto-pause | Auto-pause ACTIVE |
| Automatic mode | Enabled only after success |
| Profit-only scaling | Locked behind ladder + metrics |
| Exposure maintained | ≈6%, never unbounded |

---

## API Endpoints

### GET Endpoints
| Endpoint | Description |
|----------|-------------|
| `/api/arbitrage/status` | Overall system status |
| `/api/arbitrage/config` | Full configuration |
| `/api/arbitrage/profit-ladder` | Profit ladder status |
| `/api/arbitrage/agents` | Agent verification results |
| `/api/arbitrage/signals` | Signal detection history |
| `/api/arbitrage/executions` | Execution history |
| `/api/arbitrage/rules` | Global non-negotiable rules |

### POST Endpoints
| Endpoint | Description |
|----------|-------------|
| `/api/arbitrage/verify-all` | Run full 6-agent verification |
| `/api/arbitrage/agent/:number` | Run specific agent (1-6) |
| `/api/arbitrage/promote-tier` | Attempt tier promotion (requires authority) |
| `/api/arbitrage/record-cycle` | Record cycle result (profitable: boolean) |

---

## Usage

### Run Full Verification
```bash
# Via API
curl -X POST http://localhost:5000/api/arbitrage/verify-all

# Via Script
npx ts-node scripts/run-arbitrage-agents.ts
```

### Check Status
```bash
curl http://localhost:5000/api/arbitrage/status
```

### Promote to Next Tier
```bash
curl -X POST http://localhost:5000/api/arbitrage/promote-tier \
  -H "Content-Type: application/json" \
  -d '{"authority": "human-operator-id"}'
```

---

## Directive Compliance

- ✓ Execute agents in order (1 → 2 → 3 → 4 → 5 → 6)
- ✓ Do not skip any agent
- ✓ Enable AUTOMATIC only after unanimous success
- ✓ Promote tiers strictly via the ladder with explicit UNPAUSE
- ✓ Any failure freezes progression
