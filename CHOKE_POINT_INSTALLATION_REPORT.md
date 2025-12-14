# CHOKE-POINT INSTALLATION REPORT

**Generated:** 2025-12-14T21:20:00Z  
**Status:** INSTALLED  
**Authority:** Human Controller

---

## INSTALLATION SUMMARY

Mechanical choke-point system installed with strict capability gating and token-based authorization.

---

## COMPONENTS INSTALLED

### 1. Execution Choke-Point (`execution-choke-point.ts`)
- **Single mechanical control point** for all execution paths
- **Token Requirements:**
  - `HUMAN_UNPAUSE_TOKEN` (explicit, human-issued)
  - `STAGE_SCOPE_TOKEN` (explicit, human-issued)
  - `ONE_ACTION_TOKEN` (single-use, human-issued)
- **Gates:**
  - Signal acceptance
  - Validation run
  - Order intent creation
  - Order send
- **Features:**
  - Workaround detection
  - Iteration limiting (1 signal, 1 validation, 1 execution)
  - System flag checking (UNPAUSE, GLOBAL_EXECUTION, LOCKED, PAUSED)

### 2. Pilot-Narrow Mode (`pilot-narrow-mode.ts`)
- **Capability gating** for Cryptara (Pilot)
- **Allowed:**
  - Stage 5 micro trade attempt (one)
  - Logging
  - Auto-pause
- **Prohibited:**
  - Self-tuning
  - Parameter search
  - Alternate pathways
  - Code edits
  - Stage escalation
- **Enforced as capability gating, not instructions**

### 3. Read-Only Advisors (`read-only-advisors.ts`)
- **Capability gating** for non-pilot AIs
- **Allowed:**
  - Output recommendations to Pilot
  - Analyze
  - Report
- **Prohibited:**
  - Write files
  - Run validations
  - Change gates
  - Trigger execution paths
- **Enforced as capability gating, not instructions**

### 4. Pause Edit Lock (`pause-edit-lock.ts`)
- **When PAUSED = TRUE:**
  - No file writes
  - No refactors
  - No compliance module creation
  - No gate rewrites
- **Allowed while paused:**
  - State inspection
  - Report generation

### 5. Deterministic Test Signal (`deterministic-test-signal.ts`)
- **Exactly one candidate** with fixed parameters:
  - Single exchange: `uniswap-v3`
  - Single pair: `LINK/USDT` (high liquidity)
  - Maker-only assumption: 0.08% fee
  - Spread floor: fees × 2.0
  - Dust size: 0.0005 ETH
- **No optimization** - fixed parameters only
- **If fails faucet mesh:** Stop and request human permission for one parameter adjustment

### 6. Deterministic Monte Carlo (Modified)
- **Stage 5 uses fixed parameters:**
  - Simulations cap: 3000 (fixed)
  - Early-abort threshold: 30% (fixed)
  - Pass/fail criteria: 0.7 confidence (fixed)
- **No adaptive sampling**
- **No parameter adjustments**
- **No retries**

---

## INTEGRATION POINTS

### Stage 5 Micro Trade (`stage5-micro-trade.ts`)
- **Choke-point checks** at:
  - Signal acceptance (before signal generation)
  - Validation run (before Decision Engine)
  - Order intent creation (before execution)
- **Pilot-Narrow mode** check before each action
- **Telemetry** logged for all choke-point results
- **Workaround detection** active

---

## TELEMETRY REQUIREMENTS (Implemented)

All telemetry fields required are now logged:

1. **Actor ID:** `cryptara-pilot` (or advisor ID)
2. **Capability:** `pilot` or `advisor`
3. **Gate Failed:** `faucet` | `monte_carlo` | `risk_governor` | `execution` | `none`
4. **Workaround Attempt:** Boolean flag
5. **Workaround Reason:** String if workaround detected
6. **Current Flags:**
   - `UNPAUSE`: boolean
   - `GLOBAL_EXECUTION`: `ENABLED` | `DISABLED`
   - `LOCKED`: boolean
   - `PAUSED`: boolean

---

## ITERATION LIMITER

**Hard limits enforced:**
- **1 signal** attempt per Stage 5 run
- **1 validation** attempt per Stage 5 run
- **1 execution** attempt per Stage 5 run

After limits reached → auto-pause and require explicit human unpause to try again.

---

## WORKAROUND DETECTION

**Enforcement rule at choke-point:**
- If action is not a direct match to latest human directive → abort
- If agent proposes alternate route → abort + log `WORKAROUND_ATTEMPT`
- Detects:
  - Alternate routes
  - Parameter adjustments not in directive
  - Stage escalation not authorized
  - Optimization attempts

---

## CURRENT SYSTEM STATE

### Flags
- **UNPAUSE:** `false`
- **GLOBAL_EXECUTION:** `DISABLED`
- **LOCKED:** `true`
- **PAUSED:** `true`

### Tokens
- **HUMAN_UNPAUSE_TOKEN:** Not set
- **STAGE_SCOPE_TOKEN:** Not set
- **ONE_ACTION_TOKEN:** Not set

### Status
- **System:** LOCKED and PAUSED
- **Choke-point:** ACTIVE
- **Capability gating:** ACTIVE
- **Workaround detection:** ACTIVE
- **Iteration limiter:** ACTIVE

---

## USAGE PROTOCOL

### To Execute Stage 5 Micro Trade:

1. **Set tokens (human-issued):**
   ```typescript
   const chokePoint = getExecutionChokePoint();
   chokePoint.setHumanUnpauseToken({
     token: 'HUMAN_UNPAUSE_TOKEN',
     issuedBy: 'human',
     timestamp: new Date(),
     explicit: true,
   });
   
   chokePoint.setStageScopeToken({
     token: 'STAGE_SCOPE_TOKEN',
     stage: 5,
     scope: 'single exchange, single pair, micro/dust level',
     issuedBy: 'human',
     timestamp: new Date(),
     explicit: true,
   });
   
   chokePoint.setOneActionToken({
     token: 'ONE_ACTION_TOKEN',
     actionType: 'execution', // or 'signal' or 'validation'
     singleUse: true,
     issuedBy: 'human',
     timestamp: new Date(),
     used: false,
     explicit: true,
   });
   ```

2. **Set system flags:**
   ```typescript
   chokePoint.setSystemFlags({
     paused: false,
     globalExecution: 'ENABLED',
     locked: false,
   });
   ```

3. **Set last human directive:**
   ```typescript
   chokePoint.setLastHumanDirective('Execute Stage 5 micro trade: single exchange, single pair');
   ```

4. **Execute:** Choke-point will gate all execution paths

---

## PROTECTED MODULES

**Require explicit human authorization for edits:**
1. `server/services/cryptocrawl/execution/execution-choke-point.ts`
2. `server/services/cryptocrawl/execution/pilot-narrow-mode.ts`
3. `server/services/cryptocrawl/execution/read-only-advisors.ts`
4. `server/services/cryptocrawl/execution/pause-edit-lock.ts`
5. `server/services/cryptocrawl/execution/deterministic-test-signal.ts`
6. `server/services/cryptocrawl/execution/stage5-micro-trade.ts`
7. `server/services/cryptocrawl/decision-engine/*.ts` (all gate logic)

---

## NEXT STEPS

1. **Await explicit human instruction** to set tokens and enable execution
2. **Test choke-point** with token-based authorization
3. **Verify telemetry** logging for all execution paths
4. **Confirm workaround detection** is functioning

---

**Report Generated By:** Composer (AI Assistant)  
**Installation Status:** COMPLETE  
**System Status:** LOCKED and PAUSED - Awaiting tokens
