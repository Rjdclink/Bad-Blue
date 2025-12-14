# STAGE 4 — MAXIMAL DECISION ENGINE + MONTE CARLO GATE: DECISION SPEC

**STAGE**: 4  
**TASK**: Build Signal Fusion Gate, Monte Carlo Stress Gate, Risk Governor Gate  
**STATUS**: COMPLETE  
**OUTPUT**: DECISION SPEC

---

## DECISION ENGINE ARCHITECTURE

The Decision Engine consists of three sequential gates. **Hard Rule: If any gate fails → NO SIGNAL OUTPUT**

```
Signal Sources → [Signal Fusion Gate] → [Monte Carlo Stress Gate] → [Risk Governor Gate] → Output Signal
```

---

## GATE 1: SIGNAL FUSION GATE

### Gate Inputs List

1. **SignalInput[]** - Array of signals from multiple sources:
   - `sourceId`: string - Unique identifier for signal source
   - `sourceType`: 'cryptara' | 'cryptocrawl' | 'geoconsole' | 'computational-beam' | 'lux-swarm' | 'master-pipeline'
   - `signal`: Object containing one or more of:
     - `opportunity`: { asset, pair, chain, profitEstimate, confidence, timestamp }
     - `pattern`: { type, confidence, description }
     - `prediction`: { asset, direction, confidence, timeframe }
     - `marketData`: { volatility, liquidityScore, gasVolatility, competitorDensity, networkCongestion }
   - `metadata`: Optional additional context

### Gate Thresholds

- **minSourceAgreement**: 2 (minimum number of sources that must agree)
- **agreementThreshold**: 0.6 (minimum confidence for agreement, 0-1 scale)
- **enableWeightedFusion**: true (use weighted fusion vs simple majority)

### Gate Verdict Logic (PASS/FAIL Conditions)

**PASS Conditions**:
1. At least `minSourceAgreement` (2) sources provide signals
2. At least `minSourceAgreement` sources agree on opportunity/pattern/prediction
3. Fused confidence >= `agreementThreshold` (0.6)
4. For opportunities: Profit estimates from agreeing sources are within 20% of each other
5. For patterns: Same pattern type detected by multiple sources
6. For predictions: Same asset and direction predicted by multiple sources

**FAIL Conditions**:
- Fewer than `minSourceAgreement` sources provided
- Fewer than `minSourceAgreement` sources agree
- Fused confidence < `agreementThreshold`
- No opportunity, pattern, or prediction signals present

**Output**: `SignalFusionResult` with:
- `passed`: boolean
- `confidence`: number (0-1)
- `reason`: string
- `agreementCount`: number
- `fusedSignal`: FusedSignal (if passed)

---

## GATE 2: MONTE CARLO STRESS GATE

### Gate Inputs List

1. **FusedSignal** - Output from Signal Fusion Gate:
   - `opportunity`: { asset, pair, chain, profitEstimate, confidence, timestamp, sources }
   - `pattern`: { type, confidence, description, sources } (optional)
   - `prediction`: { asset, direction, confidence, timeframe, sources } (optional)
   - `marketData`: { volatility, liquidityScore, gasVolatility, competitorDensity, networkCongestion, sources } (optional)
   - `fusedConfidence`: number
   - `sourceCount`: number
   - `agreementCount`: number

### Gate Thresholds

- **simulations**: 10000 (number of Monte Carlo iterations)
- **confidenceLevel**: 0.95 (95% VaR)
- **minPassThreshold**: 0.7 (minimum confidence to pass, 0-1 scale)
- **stressTestVolatility**: true
- **stressTestFees**: true
- **stressTestSlippage**: true
- **stressTestLatency**: true

### Gate Verdict Logic (PASS/FAIL Conditions)

**PASS Conditions**:
1. Overall confidence >= `minPassThreshold` (0.7)
2. No kill triggers activated
3. Worst case (p5 percentile) > -50% of base profit estimate
4. VaR99 <= 80% of base profit estimate
5. Max drawdown <= 50%
6. All stress tests (volatility, fees, slippage, latency) within acceptable ranges

**FAIL Conditions**:
- Overall confidence < `minPassThreshold`
- Kill trigger activated (see Kill Switch Conditions below)
- Worst case loses more than 50% of expected profit
- VaR99 exceeds 80% of base profit
- Max drawdown exceeds 50%

**Output**: `StressTestResult` with:
- `passed`: boolean
- `confidence`: number (0-1)
- `reason`: string
- `valueAtRisk95`: number (95% VaR)
- `valueAtRisk99`: number (99% VaR)
- `conditionalVaR`: number (Expected Shortfall)
- `maxDrawdown`: number (0-1)
- `worstCasePath`: number[] (worst-case profit path)
- `volatilityStress`: { tested, worstCase, percentile95, percentile99 }
- `feesStress`: { tested, worstCase, impact }
- `slippageStress`: { tested, worstCase, impact }
- `latencyStress`: { tested, worstCase, impact }
- `killHoldTriggers`: { kill, hold, reason }
- `confidenceInterval`: [number, number]
- `percentiles`: { p5, p25, p50, p75, p95 }

---

## GATE 3: RISK GOVERNOR GATE

### Gate Inputs List

1. **FusedSignal** - Output from Signal Fusion Gate
2. **StressTestResult** - Output from Monte Carlo Stress Gate

### Gate Thresholds (Hard Ceilings)

- **maxPositionSize**: 10000 USD
- **maxDrawdown**: 0.15 (15%)
- **maxLeverage**: 3.0 (3x)
- **minLiquidity**: 100000 USD
- **maxSlippage**: 0.05 (5%)
- **maxLatency**: 500 ms
- **anomalyThreshold**: 3.0 (standard deviations)
- **varianceCeiling**: 0.25 (25%)

### Gate Verdict Logic (PASS/FAIL Conditions)

**PASS Conditions** (ALL must pass):
1. Position size <= `maxPositionSize` (10000 USD)
2. Drawdown risk <= `maxDrawdown` (15%)
3. Liquidity adequacy >= 70%
4. Slippage tolerance >= 80%
5. Latency tolerance >= 80%
6. Anomaly rate <= `varianceCeiling` (25%)
7. No critical or high severity anomalies detected

**FAIL Conditions** (ANY fails):
- Position size > `maxPositionSize`
- Drawdown risk > `maxDrawdown`
- Liquidity adequacy < 70%
- Slippage tolerance < 80%
- Latency tolerance < 80%
- Anomaly rate > `varianceCeiling`
- Critical or high severity anomalies detected

**Output**: `RiskAssessment` with:
- `passed`: boolean
- `confidence`: number (0-1)
- `reason`: string
- `positionSize`: number
- `drawdownRisk`: number
- `liquidityAdequacy`: number (0-1)
- `slippageTolerance`: number (0-1)
- `latencyTolerance`: number (0-1)
- `anomalyRate`: number (0-1)
- `positionSizeWithinLimit`: boolean
- `drawdownWithinCeiling`: boolean
- `liquidityAdequate`: boolean
- `slippageWithinTolerance`: boolean
- `latencyWithinTolerance`: boolean
- `anomalyRateWithinCeiling`: boolean
- `anomaliesDetected`: Anomaly[]

---

## KILL SWITCH CONDITIONS (Pause, Not Crash)

### Kill Switch Activation

The kill switch activates when:
1. **Consecutive Failures**: `maxConsecutiveFailures` (5) consecutive gate failures occur
2. **Monte Carlo Kill Triggers** (any of):
   - VaR99 > 80% of base profit estimate
   - Max drawdown > 50%
   - Worst case loses more than 50% of expected profit
3. **Risk Governor Kill Triggers** (any of):
   - Position size > `maxPositionSize`
   - Drawdown risk > `maxDrawdown`
   - Critical severity anomalies detected

### Kill Switch Behavior

**When Activated**:
- Decision Engine **PAUSES** (does not crash)
- All signals are **REJECTED** without processing
- Logs error with reason for activation
- Emits `kill-switch-activated` event
- System remains operational but decision engine is inactive

**Recovery**:
- Kill switch can be **reset** via explicit `resetKillSwitch()` call
- Resets consecutive failure counter to 0
- Resets kill switch active flag to false
- Emits `kill-switch-reset` event

**Configuration**:
- `killSwitch.enabled`: true
- `killSwitch.pauseOnFailure`: true (pause, not crash)
- `killSwitch.maxConsecutiveFailures`: 5

---

## DECISION ENGINE OUTPUT

### Output Signal Structure

When all gates pass, the Decision Engine outputs:

```typescript
{
  decisionId: string;
  timestamp: Date;
  verdict: 'PASS';
  gates: {
    signalFusion: GateVerdict;
    monteCarloStress: GateVerdict;
    riskGovernor: GateVerdict;
  };
  fusedSignal: FusedSignal;
  stressTestResult: StressTestResult;
  riskAssessment: RiskAssessment;
  killSwitchTriggered: false;
  recommendedCapTier: 'tier1' | 'tier2' | ... | 'tier8';
  outputSignal: {
    tradeable: true;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    recommendedAction: 'execute' | 'hold' | 'reject';
  };
}
```

### Recommended Cap Tier Eligibility

Tier ladder: $200 → $400 → $800 → $1,600 → $5,000 → $10,000 → $20,000 → $35,000

**Tier Determination Logic**:
- **tier1** ($200): confidence < 0.5 OR maxDrawdown > 0.2 OR drawdownRisk > 0.15
- **tier2** ($400): confidence < 0.6 OR maxDrawdown > 0.15 OR drawdownRisk > 0.12
- **tier3** ($800): confidence < 0.7 OR maxDrawdown > 0.12 OR drawdownRisk > 0.10
- **tier4** ($1,600): confidence < 0.75 OR maxDrawdown > 0.10 OR drawdownRisk > 0.08
- **tier5** ($5,000): confidence < 0.8 OR maxDrawdown > 0.08 OR drawdownRisk > 0.06
- **tier6** ($10,000): confidence < 0.85 OR maxDrawdown > 0.06 OR drawdownRisk > 0.05
- **tier7** ($20,000): confidence < 0.9 OR maxDrawdown > 0.05 OR drawdownRisk > 0.04
- **tier8** ($35,000): All conditions met for highest tier

---

## MONTE CARLO REQUIREMENTS (Fulfilled)

### Quantify Downside Tails (Worst-Case Paths)
✅ **Implemented**: `worstCasePath` array contains worst 10% of simulation results
✅ **Implemented**: `valueAtRisk95` and `valueAtRisk99` quantify downside risk
✅ **Implemented**: `percentiles.p5` shows 5th percentile (worst case)

### Set Adaptive Position Sizing Ceilings
✅ **Implemented**: Position size calculated from profit estimate and confidence
✅ **Implemented**: Capped by `maxPositionSize` (10000 USD)
✅ **Implemented**: Recommended cap tier eligibility based on confidence and risk

### Stress-Test Fees/Slippage/Latency
✅ **Implemented**: `feesStress` - Tests gas fee impact (up to 20% of profit)
✅ **Implemented**: `slippageStress` - Tests slippage impact (up to 15% of profit)
✅ **Implemented**: `latencyStress` - Tests latency impact (opportunity decay over time)

### Decide Whether Signal is "Tradeable"
✅ **Implemented**: `outputSignal.tradeable` boolean
✅ **Implemented**: `outputSignal.recommendedAction`: 'execute' | 'hold' | 'reject'
✅ **Implemented**: Based on overall confidence and risk assessment

### Pass/Fail Thresholds
✅ **Implemented**: `minPassThreshold` (0.7) for Monte Carlo gate
✅ **Implemented**: Individual gate thresholds for each gate
✅ **Implemented**: Overall confidence calculation

### Confidence Interval Bands
✅ **Implemented**: `confidenceInterval: [p5, p95]` (95% confidence interval)
✅ **Implemented**: `percentiles` object with p5, p25, p50, p75, p95

### Kill/Hold Triggers
✅ **Implemented**: `killHoldTriggers` object with:
- `kill`: boolean (hard stop)
- `hold`: boolean (don't execute, but don't kill)
- `reason`: string

### Recommended Cap Tier Eligibility
✅ **Implemented**: `recommendedCapTier` field in DecisionResult
✅ **Implemented**: 8-tier ladder from $200 to $35,000
✅ **Implemented**: Based on confidence, maxDrawdown, and drawdownRisk

---

## IMPLEMENTATION STATUS

✅ **Signal Fusion Gate**: IMPLEMENTED (`signal-fusion-gate.ts`)
✅ **Monte Carlo Stress Gate**: IMPLEMENTED (`monte-carlo-stress-gate.ts`)
✅ **Risk Governor Gate**: IMPLEMENTED (`risk-governor-gate.ts`)
✅ **Decision Engine**: IMPLEMENTED (`index.ts`)
✅ **Kill Switch**: IMPLEMENTED (pause on failure, not crash)
✅ **All Requirements**: FULFILLED

---

## PASS/FAIL VERDICT

**STAGE 4 STATUS**: ✅ **PASS** (Decision Engine built with all required gates)

**NEXT REQUIRED INPUT**: "STAGE 4 PASSED" to proceed to STAGE 5

---

**Report Generated**: [System timestamp]  
**Report Type**: DECISION SPEC (no trading, logic only)
