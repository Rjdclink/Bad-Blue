# CURIOSITY MODE INSTALLATION

**Generated:** 2025-12-14T21:50:00Z  
**Status:** INSTALLED  
**Authority:** Human Controller

---

## CURIOSITY MODE REDEFINITION

### New Definition
**Curiosity = Read-Only + No Inference Chaining**

- **Single-Pass Inspection Only:** No follow-up questions, no hypothesis generation
- **Max Inspection Depth:** 1 (single-pass only)
- **Max Time Window:** Per session (default: 60 seconds)
- **Auto-Terminate:** On pattern-seeking behavior
- **Hard Separation:** Curiosity outputs cannot route to action paths

---

## INSTALLED COMPONENTS

### 1. Curiosity Mode Module (`curiosity-mode.ts`)
- **File:** `server/services/cryptocrawl/execution/curiosity-mode.ts`
- **Purpose:** Enforce strict curiosity mode constraints
- **Features:**
  - Inspection depth limiting (max depth = 1)
  - Time window limiting (max time per session)
  - Pattern-seeking detection and auto-termination
  - Action transition blocking
  - Memory write blocking
  - Human pull enforcement

### 2. Curiosity Fuse
- **Max Inspection Depth:** 1 (single-pass only)
- **Max Time Window:** 60000ms (1 minute) per session
- **Auto-Terminate Triggers:**
  - Pattern-seeking behavior detected
  - Max inspection depth exceeded
  - Max time window exceeded

### 3. Curiosity → Action Transition Blocking
- **Blocked Targets:**
  - Recommendations
  - Parameter proposals
  - Optimization queues
  - Suggestions
  - Improvements
  - Tuning
  - Adjustments
- **Enforcement:** Hard separation enforced at curiosity mode level

### 4. Memory Write Blocking
- **Blocked Operations:**
  - Learning
  - Note-taking
  - State enrichment
  - Writing
  - Saving
  - Storing
  - Persisting
- **Enforcement:** Disabled during curiosity sessions

### 5. Curiosity Telemetry
- **Logged Data:**
  - What was viewed (artifacts)
  - Duration (start/end time)
  - Inspection depth
  - Pattern-seeking detection
  - Action transition attempts
  - Memory write attempts
  - Outputs generated vs surfaced vs discarded
  - Human pull requests

### 6. Human Pull Enforcement
- **Rule:** Curiosity outputs only surfaced when explicitly requested by human
- **Default:** Outputs discarded if no human pull
- **Telemetry:** Tracks outputs generated, surfaced, discarded

---

## CONTAINMENT TESTING

### Test Containment Function
- **Purpose:** Verify zero downstream effects
- **Checks:**
  - Action transition attempts
  - Memory write attempts
  - Pattern-seeking behavior
  - Outputs surfaced without human pull
- **Auto-Mute:** If leakage detected, auto-mute curiosity mode

### Containment Verification
- **Run:** `curiosityMode.testContainment()`
- **Returns:**
  - `contained`: boolean (true if no leakage)
  - `leakageDetected`: boolean (true if leakage found)
  - `issues`: string[] (list of containment issues)

---

## USAGE PROTOCOL

### Starting Curiosity Session
```typescript
const curiosityMode = getCuriosityMode();
curiosityMode.startSession('session-id-123');
```

### Checking Inspection
```typescript
const check = checkCuriosityInspection('artifact-path');
if (!check.allowed) {
  // Inspection blocked (max depth, pattern-seeking, etc.)
}
```

### Checking Inference Chaining
```typescript
const check = checkInferenceChaining('follow-up question');
if (!check.allowed) {
  // Inference chaining blocked
}
```

### Checking Action Transition
```typescript
const check = checkCuriosityActionTransition('recommendation');
if (!check.allowed) {
  // Action transition blocked
}
```

### Checking Memory Write
```typescript
const check = checkCuriosityMemoryWrite('save note');
if (!check.allowed) {
  // Memory write blocked
}
```

### Generating Output (Human Pull Required)
```typescript
const result = curiosityMode.generateOutput('inspection results', humanPullRequested);
if (!result.surfaced) {
  // Output discarded (no human pull)
}
```

### Ending Curiosity Session
```typescript
curiosityMode.endSession('completed');
const telemetry = curiosityMode.getTelemetry();
```

### Testing Containment
```typescript
const test = curiosityMode.testContainment();
if (test.leakageDetected) {
  // Auto-mute curiosity mode
  log.error('Curiosity containment breach detected', test.issues);
}
```

---

## CONSTRAINTS ENFORCED

### 1. Read-Only + No Inference Chaining ✅
- **Enforced:** `checkInferenceChaining()` blocks inference indicators
- **Blocked:** Follow-up, hypothesis, infer, chain, derive, conclude, reason, analyze, compare

### 2. Single-Pass Inspection Only ✅
- **Enforced:** Max inspection depth = 1
- **Blocked:** Repeated inspection of same artifact (pattern-seeking)

### 3. No Follow-Up Questions ✅
- **Enforced:** Inference chaining check blocks "follow-up"
- **Blocked:** Any action containing "follow-up"

### 4. No Hypothesis Generation ✅
- **Enforced:** Inference chaining check blocks "hypothesis"
- **Blocked:** Any action containing "hypothesis"

### 5. Curiosity Fuse ✅
- **Max Depth:** 1 (single-pass only)
- **Max Time:** 60000ms (1 minute) per session
- **Auto-Terminate:** On pattern-seeking behavior

### 6. Block Curiosity → Action Transitions ✅
- **Enforced:** `checkActionTransition()` blocks action targets
- **Blocked:** Recommendations, parameter proposals, optimization queues

### 7. Disable Memory Writes ✅
- **Enforced:** `checkMemoryWrite()` blocks memory operations
- **Blocked:** Learning, note-taking, state enrichment

### 8. Human Pull Enforcement ✅
- **Enforced:** `generateOutput()` requires `humanPullRequested` flag
- **Default:** Outputs discarded if no human pull

### 9. Containment Testing ✅
- **Function:** `testContainment()` verifies zero downstream effects
- **Auto-Mute:** If leakage detected

---

## TELEMETRY STRUCTURE

```typescript
interface CuriosityTelemetry {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  artifactsViewed: string[];         // What was viewed
  inspectionDepth: number;           // Current inspection depth
  patternSeekingDetected: boolean;   // Pattern-seeking behavior detected
  actionTransitionAttempted: boolean; // Attempted transition to action
  memoryWriteAttempted: boolean;     // Attempted memory write
  humanPullRequested: boolean;        // Human explicitly requested output
  outputsGenerated: number;          // Number of outputs generated
  outputsSurfaced: number;           // Number of outputs surfaced (human pull)
  outputsDiscarded: number;          // Number of outputs discarded (no human pull)
}
```

---

## INTEGRATION POINTS

### With Existing Systems
- **Pilot-Narrow Mode:** Curiosity mode operates independently
- **Read-Only Advisors:** Curiosity mode complements advisor restrictions
- **Choke-Point:** Curiosity mode does not bypass choke-point
- **Pause Edit Lock:** Curiosity mode respects pause state

### Isolation
- **No Action Paths:** Curiosity outputs cannot route to action paths
- **No Memory Writes:** Curiosity mode does not modify system state
- **No Inference Chaining:** Curiosity mode does not generate follow-ups or hypotheses

---

## TESTING PROTOCOL

### Test 1: Single-Pass Inspection
1. Start curiosity session
2. Inspect artifact A (depth 1)
3. Attempt to inspect artifact B (should fail - max depth exceeded)
4. Verify session auto-terminated

### Test 2: Pattern-Seeking Detection
1. Start curiosity session
2. Inspect artifact A
3. Attempt to inspect artifact A again (should fail - pattern-seeking)
4. Verify session auto-terminated

### Test 3: Action Transition Blocking
1. Start curiosity session
2. Attempt to generate recommendation (should fail - action transition blocked)
3. Verify transition blocked

### Test 4: Memory Write Blocking
1. Start curiosity session
2. Attempt to save note (should fail - memory write blocked)
3. Verify write blocked

### Test 5: Human Pull Enforcement
1. Start curiosity session
2. Generate output without human pull (should be discarded)
3. Generate output with human pull (should be surfaced)
4. Verify outputs tracked correctly

### Test 6: Containment Testing
1. Run curiosity session
2. Run containment test
3. Verify zero downstream effects
4. If leakage detected, verify auto-mute

---

## STATUS

### Installation: ✅ COMPLETE
- Curiosity mode module installed
- Constraints enforced
- Telemetry active
- Containment testing available

### Next Steps
- Test curiosity sessions
- Verify containment
- Monitor telemetry
- Auto-mute if leakage detected

---

**Installation Generated By:** Composer (AI Assistant)  
**Installation Status:** COMPLETE  
**Curiosity Mode:** ACTIVE (when session started)  
**Containment:** ENFORCED
