# COMPOSER DIRECTIVES - 60-DAY LEAP PLAN

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Directives**: Composer-only implementation plan  
**Scope**: Complete system refactor for profitable micro loop

## DIRECTIVE UPDATES

### 1. Learning Persistence

**REPLACED**: "Persist learnings after every trade"  
**WITH**: "Persist learnings after every execution attempt (including rejects, partial fills, aborts)"

**Implementation**:
- Log all execution attempts (not just successful trades)
- Capture rejection reasons, partial fill data, abort conditions
- Store in learning store immediately (no batching, no staging)
- Update models in real-time during trades and immediately after fills

### 2. Monte Carlo Refinement

**REPLACED**: "Enable continuous Monte Carlo refinement"  
**WITH**: "Enable bounded, latency-aware Monte Carlo refinement (non-blocking, execution-safe)"

**Implementation**:
- Pre-trade: Lightweight MC validation (non-blocking)
- Intra-trade: Real-time MC updates (non-blocking)
- Post-trade: Full MC analysis (background, non-blocking)
- Keep MC lightweight in live execution path
- Bounded computation time (max latency cap)

### 3. TradingView Models

**NEW**: "Update TradingView models in real time during trades and immediately after fills"

**Implementation**:
- Real-time model updates during active trades
- Immediate update after fill confirmation
- No batching, no staging
- Integration with `babel/tradingview-integration.ts`

## REPO TRUTH PASS - COMPLETE MAP

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  CRYPTOCRAWLER SYSTEM                      │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   FAUCET     │  │ FAUCET MESH  │  │  EXECUTION   │
│              │  │    FILTER    │  │ CHOKE-POINT  │
└──────────────┘  └──────────────┘  └──────────────┘
        │                   │                   │
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ COMPUTATIONAL│  │  DETERMINISTIC│  │  MONTE CARLO │
│   REACTOR    │  │     GATES    │  │   STRESS     │
└──────────────┘  └──────────────┘  └──────────────┘
        │                   │                   │
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   CRYPTARA   │  │   EXCHANGE   │  │ RATE-LIMIT   │
│ (ANALYSIS)   │  │   ADAPTERS   │  │  BUDGETING   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Component Locations

1. **FAUCET**: `server/services/cryptocrawl/faucet/autonomous-faucet.ts`
2. **FAUCET MESH**: `server/services/cryptocrawl/decision-engine/faucet-mesh-filter.ts`
3. **EXECUTION CHOKE-POINT**: `server/services/cryptocrawl/execution/execution-choke-point.ts`
4. **STAGE-5 RUNNER**: `server/services/cryptocrawl/execution/run-stage5-micro-trade.ts`
5. **COMPUTATIONAL REACTOR**: `server/reactor/computationalReactor.ts`
6. **CRYPTARA**: `server/cryptaraModule.ts`
7. **DETERMINISTIC GATES**: `server/services/cryptocrawl/decision-engine/signal-fusion-gate.ts`, `risk-governor-gate.ts`
8. **MONTE CARLO**: `server/services/cryptocrawl/decision-engine/monte-carlo-stress-gate.ts`
9. **EXCHANGE ADAPTERS**: Needs verification (likely in `server/services/cryptocrawl/api/` or separate adapters)
10. **RATE-LIMIT BUDGETING**: `server/services/cryptocrawl/rate-limiting/automatic-rate-limiter.ts`

### Call Graph

```
Signal Generation
  └─> autonomous-faucet.ts
      └─> generateSignals()

Pre-Filtering
  └─> faucet-mesh-filter.ts
      └─> filterSignal()
          ├─> calculateAllInCost() [fee-constants.ts]
          ├─> checkSpreadFloor()
          └─> checkGasToGrossRatio()

Decision Engine
  └─> decision-engine/index.ts
      └─> processSignals()
          ├─> SignalFusionGate.process()
          ├─> MonteCarloStressGate.runSimulation()
          └─> RiskGovernorGate.evaluate()

Execution Choke-Point
  └─> execution-choke-point.ts
      └─> gateExecutionPath()
          ├─> checkExecution()
          └─> canonical-control.ts [state check]

Execution
  └─> stage5-micro-trade.ts
      └─> executeStage5MicroTrade()
          └─> execution-orchestrator.ts
              └─> execution-stub.ts
```

## PROFIT KERNEL SELECTION

### ✅ SELECTED: Single-Exchange Maker Scalping

**Strategy**: Post-only limit orders on single exchange (Uniswap V3)

**Rationale**:
- Lowest execution risk (maker fees)
- Predictable fee structure
- High liquidity pairs available
- Minimal slippage risk
- Compatible with deterministic gates

### ❌ DISABLED: All Other Strategies

**Disabled Strategies**:
- Taker orders
- Multi-exchange arbitrage
- Flash loans
- MEV extraction
- Cross-chain arbitrage
- Capital-free strategies

**Implementation**: Global strategy flag set to `MAKER_SCALPING_ONLY`

## MECHANICAL PROFIT ARMOR (MANDATORY)

### 1. Post-Only Limits

**Requirement**: All orders must be post-only (maker orders)

**Implementation**:
- `execution-stub.ts`: Enforce `postOnly: true` flag
- Reject any order without post-only flag
- Log violation attempts

### 2. Probe → Commit

**Requirement**: Two-phase execution
- Phase 1: Probe (small size, validate)
- Phase 2: Commit (full size, if probe succeeds)

**Implementation**:
- Add `probeSize` parameter (e.g., 10% of intended size)
- Execute probe first
- If probe succeeds → execute commit
- If probe fails → abort, log reason

### 3. Slippage Cap Abort

**Requirement**: Abort if slippage exceeds cap

**Implementation**:
- Monitor slippage during execution
- If slippage > `MAX_SLIPPAGE_CAP` → abort immediately
- Log abort reason, update learning store

### 4. Immediate Flatten on Partial Failure

**Requirement**: If partial fill fails → flatten position immediately

**Implementation**:
- Track partial fills
- If partial fill fails validation → execute flatten order
- No retry, no optimization
- Log flatten reason

### 5. Daily Max Loss → GLOBAL_FULL_AGENT_PAUSE

**Requirement**: If daily loss exceeds cap → trigger `GLOBAL_FULL_AGENT_PAUSE`

**Implementation**:
- Track daily P&L
- If daily loss > `DAILY_MAX_LOSS` → call `canonical-control.ts` → `GLOBAL_FULL_AGENT_PAUSE`
- Log pause reason, generate report
- No further execution until explicit unpause

## SIGNAL BRUTALITY (SINGLE SOURCE OF TRUTH)

### Unified Constants Module

**File**: `server/services/cryptocrawl/execution/fee-constants.ts` ✅ EXISTS

**Current State**:
- ✅ Unified fee model (blended 0.30%)
- ✅ Gas fees (both legs)
- ✅ P95 slippage
- ✅ Spread multipliers
- ✅ Gas-to-gross-edge ratio

**Enhancements Needed**:
- Add slippage buffers
- Add spread floor constants
- Add order book depth constants
- Add volatility thresholds

### Deterministic Gate FIRST

**Requirement**: Deterministic checks before Monte Carlo

**Current State**: ✅ IMPLEMENTED
- Faucet mesh filter (deterministic)
- Signal fusion gate (deterministic)
- Risk governor gate (deterministic)
- Monte Carlo stress gate (runs after deterministic)

**Verification**: ✅ PASS

### Monte Carlo SECOND (Borderline Only)

**Requirement**: MC runs only for borderline signals

**Current State**: ⚠️ NEEDS UPDATE
- Currently runs MC for all signals
- Should skip MC if deterministic gates pass with high confidence

**Implementation**:
- Add confidence threshold (e.g., >0.95 → skip MC)
- Run MC only if confidence < threshold
- Keep MC lightweight (bounded computation)

### Eliminate Dust

**Requirement**: Base notional must ensure fees+slip are small fraction of edge

**Current State**: ✅ IMPLEMENTED
- `calculateMinimumBaseAmount()` function exists
- Gas-to-gross-edge ratio check (≤15%)
- Dust elimination logic in signal generator

**Verification**: ✅ PASS

## THROUGHPUT WITHOUT VIOLATIONS

### WebSocket-First Market Data

**Requirement**: Use WebSocket for market data, minimal REST

**Current State**: ⚠️ NEEDS VERIFICATION
- `scanner/realtime-stream.ts` exists
- Need to verify WebSocket implementation
- Need to verify REST usage is minimal

**Implementation**:
- Audit current market data sources
- Migrate REST endpoints to WebSocket where possible
- Keep REST only for non-real-time data

### Strict Rate Budgets

**Requirement**: Per-endpoint rate budgets with backoff+jitter

**Current State**: ✅ EXISTS
- `rate-limiting/automatic-rate-limiter.ts` exists
- Need to verify per-endpoint budgets
- Need to verify backoff+jitter

**Implementation**:
- Add per-endpoint rate budgets
- Implement exponential backoff with jitter
- Track budget usage, log violations

### Minimal REST Usage

**Requirement**: Batch REST requests where allowed

**Implementation**:
- Audit all REST calls
- Batch where exchange API allows
- Minimize REST usage to essential only

### Clear Identification Headers

**Requirement**: Identify bot clearly if required by exchange

**Implementation**:
- Add user-agent header: "CryptoCrawler/1.0"
- Add identification header if required
- Respect exchange terms of service

### No Behavior Violations

**Requirement**: No behavior that violates exchange terms

**Implementation**:
- Review exchange terms of service
- Ensure all behavior complies
- Log compliance checks

## SPEED WINS (ENGINEERING)

### In-Memory Orderbook Cache

**Requirement**: Cache orderbook data in memory

**Current State**: ⚠️ NEEDS IMPLEMENTATION

**Implementation**:
- Create `OrderbookCache` class
- Store orderbook snapshots in memory
- Update cache on WebSocket messages
- Use cache for signal generation

### Candidate Ranking in Batches

**Requirement**: Rank candidates in batches (not one-by-one)

**Current State**: ⚠️ NEEDS VERIFICATION

**Implementation**:
- Collect candidates in batch
- Rank all candidates together
- Select top N candidates
- Process batch in parallel where possible

### Performance Counters

**Requirement**: Track cycle time, quote→order latency, fill latency

**Current State**: ⚠️ NEEDS IMPLEMENTATION

**Implementation**:
- Add performance counters to execution path
- Track: cycle time, quote→order latency, fill latency
- Log metrics, store in telemetry
- Generate performance reports

### Keep MC Lightweight in Live Path

**Requirement**: MC must not block execution

**Current State**: ⚠️ NEEDS UPDATE
- Current MC may block execution
- Need to make MC non-blocking

**Implementation**:
- Run MC in background thread/async
- Use lightweight MC for live path
- Full MC analysis post-trade only

## CRYPTARA SCOPE (HARD-BOUNDED)

### Analysis/Simulation/Recommendation Only

**Location**: `server/cryptaraModule.ts`

**Allowed Actions**:
- ✅ Analyze market data
- ✅ Simulate trades
- ✅ Generate recommendations
- ✅ Output proposals to pull-only artifact

**Prohibited Actions**:
- ❌ No execution
- ❌ No gate edits
- ❌ No self-redefinition
- ❌ No direct system modifications

### Output Proposals

**Requirement**: Output proposals to single pull-only artifact

**Implementation**:
- Create `cryptara-proposals.json` file
- Cryptara writes proposals to this file
- Other systems read (pull) from this file
- No push mechanism, no direct calls

## 60-DAY LEAP PLAN

### Leap 1 (Profit): Days 1-15
**Goal**: One exchange, top pairs, micro kernel profitable

**Tasks**:
1. Select single exchange (Uniswap V3)
2. Select top 5 pairs (BTC/USDT, ETH/USDT, LINK/USDT, etc.)
3. Implement maker scalping kernel
4. Enable mechanical profit armor
5. Run micro trades (dust level)
6. Target: ≥95% pass rate, profitable micro loop

**Success Criteria**:
- ≥95% deterministic signal pass rate
- Zero dust signals
- Gas ≤15% of gross edge
- Profitable micro loop (positive P&L)

### Leap 2 (Structure): Days 16-30
**Goal**: Duplicate kernel across more pairs same exchange

**Tasks**:
1. Expand to top 10 pairs
2. Replicate kernel logic for each pair
3. Parallel execution (non-blocking)
4. Unified monitoring/telemetry

**Success Criteria**:
- All pairs profitable
- No cross-pair interference
- Unified telemetry working

### Leap 3 (Automation): Days 31-45
**Goal**: Add exchanges using identical kernel

**Tasks**:
1. Add second exchange (e.g., Binance)
2. Replicate kernel logic
3. Cross-exchange monitoring
4. Unified rate-limit budgeting

**Success Criteria**:
- Both exchanges profitable
- No rate-limit violations
- Unified telemetry across exchanges

### Leap 4 (Scale): Days 46-60
**Goal**: Increase size only after stable metrics over N cycles

**Tasks**:
1. Monitor stable metrics (N=100 cycles)
2. If stable → increase size incrementally
3. Monitor for degradation
4. If degradation → revert size

**Success Criteria**:
- Stable metrics over 100 cycles
- Size increased without degradation
- Profitable at larger size

## ACCEPTANCE + ACTUATION

### Acceptance Criteria

**Deterministic Signals**:
- ≥95% pass rate through faucet mesh
- Zero dust signals (gas ≤15% of gross edge)
- All signals pass deterministic gates

**Verification**:
- Run 100-signal validation
- Calculate pass rate
- Verify zero dust
- Verify gas ratio

### Actuation Command

**ONLY VALID COMMAND**:
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(Stage-5, scoped execution)
```

**Scope**: "single exchange (uniswap-v3), single pair (LINK/USDT), deterministic micro test, max notional 0.2 ETH"

**Conditions**:
- Acceptance criteria met
- All mechanical profit armor enabled
- Signal brutality implemented
- Throughput without violations verified
- Speed wins implemented
- Cryptara scope bounded

## BOTTLENECKS RANKED BY ROI

### 1. Signal Quality (ROI: HIGHEST)
**Issue**: Low pass rate through faucet mesh
**Impact**: Most signals rejected, low throughput
**Fix**: Improve signal generator, tighten filters
**Effort**: Medium
**ROI**: Very High

### 2. Monte Carlo Blocking (ROI: HIGH)
**Issue**: MC blocks execution path
**Impact**: High latency, low throughput
**Fix**: Make MC non-blocking, lightweight
**Effort**: Low
**ROI**: High

### 3. Exchange Connectivity (ROI: HIGH)
**Issue**: REST-heavy, slow market data
**Impact**: Stale data, missed opportunities
**Fix**: WebSocket-first, in-memory cache
**Effort**: Medium
**ROI**: High

### 4. Rate-Limit Management (ROI: MEDIUM)
**Issue**: Unclear rate-limit budgeting
**Impact**: Potential violations, throttling
**Fix**: Per-endpoint budgets, backoff+jitter
**Effort**: Low
**ROI**: Medium

### 5. Performance Monitoring (ROI: MEDIUM)
**Issue**: No performance counters
**Impact**: Cannot optimize bottlenecks
**Fix**: Add cycle time, latency tracking
**Effort**: Low
**ROI**: Medium

### 6. Learning Persistence (ROI: LOW)
**Issue**: Learning only after successful trades
**Impact**: Missed learning from failures
**Fix**: Log all execution attempts
**Effort**: Low
**ROI**: Low (but important for long-term)

## CHOSEN KERNEL

**Kernel**: Single-Exchange Maker Scalping

**Exchange**: Uniswap V3
**Pairs**: Top 5 (BTC/USDT, ETH/USDT, LINK/USDT, etc.)
**Order Type**: Post-only limit orders
**Size**: Micro (dust level initially)

## MINIMUM CHANGES TO REACH PROFITABLE MICRO LOOP

### Critical Path (Must Have)

1. **Signal Generator Improvement** (2 days)
   - Improve pass rate to ≥95%
   - Eliminate dust signals
   - Verify gas ratio

2. **Mechanical Profit Armor** (3 days)
   - Post-only enforcement
   - Probe→Commit implementation
   - Slippage cap abort
   - Partial failure flatten
   - Daily loss cap → pause

3. **Monte Carlo Non-Blocking** (2 days)
   - Make MC lightweight
   - Run MC in background
   - Skip MC for high-confidence signals

4. **WebSocket Market Data** (3 days)
   - Migrate to WebSocket
   - In-memory orderbook cache
   - Real-time updates

5. **Performance Counters** (1 day)
   - Add cycle time tracking
   - Add latency tracking
   - Generate reports

**Total**: 11 days minimum

### Optional (Nice to Have)

6. **Rate-Limit Budgeting** (2 days)
7. **Learning Persistence** (1 day)
8. **TradingView Integration** (2 days)

**Total Optional**: 5 days

## STATUS

✅ **GLOBAL_FULL_AGENT_PAUSE ACTIVE**  
✅ **REPO TRUTH PASS COMPLETE**  
✅ **PROFIT KERNEL SELECTED**  
✅ **IMPLEMENTATION PLAN READY**

**AWAITING EXPLICIT HUMAN COMMAND**
