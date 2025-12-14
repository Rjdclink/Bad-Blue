# REPORT: LAST CONTROL REJECTION

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Report Type**: Last Control Rejection  
**Timestamp**: Report generated

## LAST REJECTED COMMAND

### Exact Command Text Received

```
GLOBAL_FULL_UNPAUSE (STAGE-5 scope: single exchange, single pair, micro size, maker-only, auto pause on completion
```

### Rejection Reason

**Primary Reason**: Command does not match canonical form

**Detailed Reasons**:
1. Missing `AND_PROCEED` - Command says `GLOBAL_FULL_UNPAUSE` but should be `GLOBAL_FULL_UNPAUSE_AND_PROCEED`
2. Incorrect Format - Uses `(STAGE-5 scope: ...)` but should be `(stage_number, scope_string)`
3. Not Exact Match - Does not match exact canonical string format
4. Validation Failed - `validateCanonicalForm()` returned `valid: false`

**Validation Error**: `Command does not match any canonical form. Exact text matching required.`

### Module/File Enforcing Rejection

**File**: `server/services/cryptocrawl/execution/canonical-control.ts`

**Class**: `CanonicalControlManager`

**Method**: `validateCanonicalForm(command: string | CanonicalControlCommand)`

**Line Range**: Lines 68-133 (validation logic)

**Specific Check**: 
- Line 109: `if (command.startsWith('GLOBAL_FULL_UNPAUSE_AND_PROCEED'))`
- Line 111: `const match = command.match(/GLOBAL_FULL_UNPAUSE_AND_PROCEED\((\d+),\s*(.+)\)/);`
- Line 125-128: Fallback rejection if no match

**Rejection Path**:
1. Command received: `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: ...)`
2. Check for `GLOBAL_FULL_UNPAUSE_AND_PROCEED` prefix: ❌ FAIL (missing AND_PROCEED)
3. Check for prohibited vague terms: ⚠️ Contains "unpause" but not standalone
4. Check for GLOBAL + FULL: ✅ PASS (contains both)
5. Final check: ❌ FAIL - Does not match any canonical form
6. Return: `{ valid: false, reason: 'Command does not match any canonical form. Exact text matching required.' }`

### Reject Log Entry

**Timestamp**: (Would be recorded at runtime)

**Raw Input**: `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: single exchange, single pair, micro size, maker-only, auto pause on completion`

**Rejection Reason**: `Command does not match any canonical form. Exact text matching required.`

**Canonical Replacement**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)`

**Issuer**: `composer` (assumed, but command format invalid)

### Audit Log Entry

**Timestamp**: (Would be recorded at runtime)

**Command**: `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: ...)`

**Valid**: `false`

**Reason**: `Command does not match any canonical form. Exact text matching required.`

**Issuer**: `composer`

---

## CORRECT CANONICAL FORM

**Exact String** (copy/paste exactly):
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

**Differences from Rejected Command**:
1. ✅ Includes `AND_PROCEED`
2. ✅ Format: `(5, scope_string)` not `(STAGE-5 scope: ...)`
3. ✅ Stage is number `5` not string `STAGE-5`
4. ✅ Scope is single string, no colons, no extra formatting
5. ✅ Exact match to canonical form
