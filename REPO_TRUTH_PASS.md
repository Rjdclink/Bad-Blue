# REPO TRUTH PASS - CRYPTOCRAWLER END-TO-END MAP

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Timestamp**: Audit in progress  
**Scope**: Complete system mapping

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRYPTOCRAWLER SYSTEM                         │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   FAUCET     │───▶│ FAUCET MESH  │───▶│  EXECUTION   │
│              │    │    FILTER    │    │ CHOKE-POINT  │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ COMPUTATIONAL│    │  DETERMINISTIC│   │  MONTE CARLO │
│   REACTOR    │    │     GATES    │    │   STRESS     │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   CRYPTARA   │    │   EXCHANGE   │    │ RATE-LIMIT   │
│ (ANALYSIS)  │    │   ADAPTERS   │    │  BUDGETING    │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Component Map

### 1. FAUCET + FAUCET MESH

**Location**: `server/services/cryptocrawl/decision-engine/faucet-mesh-filter.ts`

**Purpose**: Pre-filter signals based on stringent criteria before decision engine

**Key Functions**:
- `filterSignal()` - Main filtering logic
- `calculateAllInCost()` - Unified fee calculation
- `checkSpreadFloor()` - Minimum spread requirements
- `checkGasToGrossRatio()` - Gas cost validation

**Dependencies**:
- `fee-constants.ts` - Unified fee model
- Signal input from faucet

**Call Graph**:
```
faucet → faucet-mesh-filter → decision-engine
```

### 2. EXECUTION CHOKE-POINT / STAGE-5 RUNNER

**Location**: 
- `server/services/cryptocrawl/execution/execution-choke-point.ts`
- `server/services/cryptocrawl/execution/run-stage5-micro-trade.ts`
- `server/services/cryptocrawl/execution/stage5-micro-trade.ts`

**Purpose**: Single mechanical control point for all execution paths

**Key Functions**:
- `gateExecutionPath()` - Single choke-point function
- `setStage5Token()` - Token management
- `checkExecution()` - Main gating logic
- `executeStage5MicroTrade()` - Stage-5 execution orchestrator

**Dependencies**:
- `canonical-control.ts` - Control vocabulary
- `deterministic-test-signal.ts` - Signal generation
- Decision engine results

**Call Graph**:
```
stage5-micro-trade → execution-choke-point → canonical-control
                 ↓
         decision-engine
                 ↓
         execution-orchestrator → execution-stub
```

### 3. COMPUTATIONAL REACTOR

**Status**: ⚠️ NOT FOUND IN CURRENT CODEBASE

**Expected Location**: `server/services/cryptocrawl/computational-reactor/` or similar

**Purpose**: (To be determined - may be planned but not implemented)

**Action Required**: Investigate if this component exists under different name or is planned

### 4. CRYPTARA (ANALYSIS-ONLY)

**Status**: ⚠️ NOT FOUND AS DISTINCT MODULE

**Expected Location**: May be integrated into decision engine or separate analysis module

**Purpose**: Analysis, simulation, recommendation only (no execution)

**Action Required**: Identify Cryptara implementation or create scope definition

### 5. DETERMINISTIC GATES + MONTE CARLO

**Location**: 
- `server/services/cryptocrawl/decision-engine/signal-fusion-gate.ts`
- `server/services/cryptocrawl/decision-engine/monte-carlo-stress-gate.ts`
- `server/services/cryptocrawl/decision-engine/risk-governor-gate.ts`
- `server/services/cryptocrawl/decision-engine/index.ts`

**Purpose**: Multi-stage decision gates with deterministic and Monte Carlo validation

**Key Functions**:
- `SignalFusionGate.process()` - Multi-source agreement
- `MonteCarloStressGate.runSimulation()` - Stress testing
- `RiskGovernorGate.evaluate()` - Final risk ceilings
- `DecisionEngine.processSignals()` - Orchestration

**Dependencies**:
- Signal inputs from faucet mesh
- Fee constants
- Market data

**Call Graph**:
```
faucet-mesh-filter → decision-engine
                           ↓
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      signal-fusion  monte-carlo  risk-governor
              │            │            │
              └────────────┼────────────┘
                           ▼
                    decision-result
```

### 6. EXCHANGE ADAPTERS (REST + WS)

**Status**: ⚠️ NEEDS VERIFICATION

**Expected Location**: `server/services/cryptocrawl/exchange/` or `server/services/cryptocrawl/adapters/`

**Purpose**: Exchange connectivity (REST and WebSocket)

**Action Required**: Map existing exchange adapter implementations

### 7. RATE-LIMIT BUDGETING + TELEMETRY

**Status**: ⚠️ NEEDS VERIFICATION

**Expected Location**: May be integrated into exchange adapters or separate module

**Purpose**: Rate limit management and telemetry

**Action Required**: Identify rate-limit implementation

## File/Path Map

### Core Execution Path

```
server/services/cryptocrawl/
├── decision-engine/
│   ├── index.ts                    # Main decision engine orchestrator
│   ├── faucet-mesh-filter.ts       # Pre-filter signals
│   ├── signal-fusion-gate.ts       # Multi-source agreement
│   ├── monte-carlo-stress-gate.ts   # Monte Carlo stress testing
│   └── risk-governor-gate.ts        # Final risk ceilings
│
├── execution/
│   ├── execution-choke-point.ts    # Single control point
│   ├── stage5-micro-trade.ts       # Stage-5 execution orchestrator
│   ├── run-stage5-micro-trade.ts    # Stage-5 runner script
│   ├── execution-orchestrator.ts   # Execution coordination
│   ├── execution-stub.ts            # Mock execution layer
│   ├── deterministic-test-signal.ts # Deterministic signal generation
│   ├── fee-constants.ts            # Unified fee model
│   ├── canonical-control.ts        # Control vocabulary
│   └── [other execution modules]
│
└── [other services]
```

## Call Graph

### Signal Flow

```
1. Signal Generation
   └─> deterministic-test-signal.ts
       └─> generateDeterministicTestSignal()

2. Pre-Filtering
   └─> faucet-mesh-filter.ts
       └─> filterSignal()
           ├─> calculateAllInCost() [fee-constants.ts]
           ├─> checkSpreadFloor()
           └─> checkGasToGrossRatio()

3. Decision Engine
   └─> decision-engine/index.ts
       └─> processSignals()
           ├─> SignalFusionGate.process()
           ├─> MonteCarloStressGate.runSimulation()
           └─> RiskGovernorGate.evaluate()

4. Execution Choke-Point
   └─> execution-choke-point.ts
       └─> gateExecutionPath()
           ├─> checkExecution()
           └─> canonical-control.ts [state check]

5. Execution
   └─> stage5-micro-trade.ts
       └─> executeStage5MicroTrade()
           └─> execution-orchestrator.ts
               └─> execution-stub.ts
```

## Missing Components (To Be Investigated)

1. **Computational Reactor** - Not found in codebase
2. **Cryptara Module** - Not found as distinct module
3. **Exchange Adapters** - Needs verification
4. **Rate-Limit Budgeting** - Needs verification
5. **WebSocket Market Data** - Needs verification

## Next Steps

1. Search for computational reactor implementation
2. Identify Cryptara analysis module
3. Map exchange adapter structure
4. Verify rate-limit implementation
5. Document WebSocket market data flow
