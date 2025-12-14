# READY FOR ACTUATION - CANONICAL COMMAND REQUIRED

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Previous Command**: Rejected (not canonical)  
**Ready**: Yes - Awaiting exact canonical command

## PREVIOUS COMMAND ATTEMPT

**User Command**:
```
GLOBAL_FULL_UNPAUSE (STAGE-5 scope: single exchange, single pair, micro size, maker-only, auto pause on completion
```

**Result**: ❌ REJECTED - Not in canonical form

**Issues**:
- Missing `AND_PROCEED` in command name
- Incorrect format (should be `(stage, scope)` not `(STAGE-5 scope: ...)`)
- Not exact match to canonical form

## CORRECT CANONICAL COMMAND

**Exact String** (copy/paste exactly):
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

**Format**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)`

**Parameters**:
- Stage: `5` (number, not "STAGE-5")
- Scope: `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion` (single string, no colons, no parentheses)

## SYSTEM READINESS

### ✅ Profit Kernel Locked
- Single-Exchange Maker Scalping only
- All other strategies disabled

### ✅ Signal Reliability Enforced
- Unified fee constants (`fee-constants.ts`)
- `grossEdge >= allInCost * 1.30` enforced
- `fees+slippage <= 15% of grossEdge` enforced
- No dust signals

### ✅ Mechanical Downside Caps
- Post-only limits enforced
- Probe → Commit implemented
- Hard slippage abort (5% cap)
- Immediate flatten on partial failure
- Daily max loss → GLOBAL_FULL_AGENT_PAUSE integrated

### ✅ Non-Blocking Optimization
- Runs in parallel with validation
- Safety gates prevent mid-cycle order alterations
- Applied post-trade or on abort only

### ✅ First Money Cycle Prepared
- Exchange: `uniswap-v3`
- Pair: `LINK/USDT` (or top 3-5 pairs)
- Size: Micro (auto-adjusted to eliminate dust)
- Order Type: Maker-only (post-only)

## EXECUTION FLOW (When Unpaused)

1. **Signal Generation**
   - Generate deterministic test signal
   - Enforce constraints (grossEdge, fees+slippage)
   - Return null if constraints cannot be met

2. **Faucet Mesh Filter**
   - Pre-filter signals
   - Use unified fee constants
   - Check spread floor, gas ratio

3. **Decision Engine** (with non-blocking optimization)
   - Signal fusion gate
   - Monte Carlo stress gate (non-blocking)
   - Risk governor gate
   - Pre/intra-trade optimization in parallel

4. **Execution Choke-Point**
   - Validate canonical control state
   - Check profit kernel constraints
   - Gate execution path

5. **Execution** (with safety gates)
   - Register active order (optimization locked)
   - Post-only limit order
   - Probe → Commit (if enabled)
   - Monitor slippage (abort if >5%)
   - Flatten on partial failure/timeout
   - Track daily loss (pause if >$1000)
   - Unregister active order (optimization unlocked)

6. **Post-Trade** (with non-blocking optimization)
   - Calculate net P&L
   - Log fees, slippage, latency
   - Record fill rate
   - Log reject reason (if any)
   - Post-trade optimization (non-blocking)
   - Apply pending optimizations (if safe)
   - Auto-pause via canonical control

## OUTPUT REQUIREMENTS

After completion, output:
- **Net P&L**: Profit/loss in USD
- **Fees**: Total fees paid
- **Slippage**: Actual slippage vs expected
- **Latency**: Quote→order→fill latency
- **Fill Rate**: Percentage filled
- **Reject Reason**: If execution was rejected

## STATUS

✅ **SYSTEM READY**  
✅ **ALL COMPONENTS CONFIGURED**  
✅ **SAFETY GATES ENFORCED**  
⏸️ **GLOBAL_FULL_AGENT_PAUSE ACTIVE**

**AWAITING EXACT CANONICAL COMMAND**

The only valid command format:
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```
