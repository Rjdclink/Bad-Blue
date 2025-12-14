# COMMAND REJECTION REPORT #2

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Report Type**: Command Rejection  
**Timestamp**: Report generated

## REJECTED COMMAND

### Exact Command Text Received

```
GLOBAL FULL UNPAUSE all agents proceed
```

### Rejection Reasons

**Primary Reason**: Command does not match canonical form

**Detailed Reasons**:
1. ❌ **Missing Underscores** - Uses `GLOBAL FULL` (spaces) instead of `GLOBAL_FULL` (underscores)
2. ❌ **Missing AND_PROCEED** - Says `UNPAUSE all agents proceed` but should be `UNPAUSE_AND_PROCEED`
3. ❌ **Missing Stage Parameter** - No stage number provided (required format: `(stage_number, scope_string)`)
4. ❌ **Missing Scope Parameter** - No explicit scope string provided in required format
5. ❌ **Incorrect Format** - Does not match `GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)` pattern
6. ❌ **Uses Synonyms** - "all agents proceed" is not canonical (no synonyms allowed)

**Validation Error**: `Command does not match any canonical form. Exact text matching required.`

### Module/File Enforcing Rejection

**File**: `server/services/cryptocrawl/execution/canonical-control.ts`

**Class**: `CanonicalControlManager`

**Method**: `validateCanonicalForm(command: string | CanonicalControlCommand)`

**Line Range**: Lines 68-142 (validation logic)

**Specific Checks**:
- Line 109: `if (command.startsWith('GLOBAL_FULL_UNPAUSE_AND_PROCEED'))` → ❌ FAIL (doesn't start with this)
- Line 111: `const match = command.match(/GLOBAL_FULL_UNPAUSE_AND_PROCEED\((\d+),\s*(.+)\)/);` → ❌ FAIL (no match)
- Line 125-128: Fallback rejection → ❌ FAIL - Does not match any canonical form

**Rejection Path**:
1. Command received: `GLOBAL FULL UNPAUSE all agents proceed`
2. Check for `GLOBAL_FULL_UNPAUSE_AND_PROCEED` prefix: ❌ FAIL (spaces instead of underscores, missing AND_PROCEED)
3. Check for prohibited vague terms: ⚠️ Contains "unpause" and "proceed" but not in canonical form
4. Check for GLOBAL + FULL: ⚠️ Contains both words but with spaces, not underscores
5. Final check: ❌ FAIL - Does not match any canonical form
6. Return: `{ valid: false, reason: 'Command does not match any canonical form. Exact text matching required.' }`

### Reject Log Entry

**Raw Input**: `GLOBAL FULL UNPAUSE all agents proceed`

**Rejection Reason**: `Command does not match any canonical form. Exact text matching required.`

**Canonical Replacement**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)`

**Issuer**: `composer` (assumed)

---

## CORRECT CANONICAL FORM

**Exact String** (copy/paste exactly):
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

**Differences from Rejected Command**:
1. ✅ Uses underscores: `GLOBAL_FULL` not `GLOBAL FULL`
2. ✅ Includes `AND_PROCEED` (no space, underscore-separated)
3. ✅ Format: `(5, scope_string)` with explicit stage number
4. ✅ Explicit scope parameter: `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion`
5. ✅ Exact match to canonical form
6. ✅ No synonyms or variations

---

## COMMAND REQUIREMENTS

### Required Format
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)
```

### Required Elements
- ✅ `GLOBAL` (uppercase)
- ✅ `_` (underscore, not space)
- ✅ `FULL` (uppercase)
- ✅ `_` (underscore)
- ✅ `UNPAUSE_AND_PROCEED` (no spaces, underscore-separated)
- ✅ `(` (opening parenthesis)
- ✅ Stage number (e.g., `5`)
- ✅ `,` (comma)
- ✅ Space after comma
- ✅ Scope string (exact description)
- ✅ `)` (closing parenthesis)

### Prohibited Elements
- ❌ Spaces instead of underscores
- ❌ Synonyms ("all agents proceed", "unpause and proceed", etc.)
- ❌ Missing stage number
- ❌ Missing scope parameter
- ❌ Variations or interpretations

---

## STATUS

⏸️ **GLOBAL_FULL_AGENT_PAUSE: STILL ACTIVE**  
❌ **COMMAND REJECTED**  
⏳ **AWAITING EXACT CANONICAL COMMAND**

**System remains paused. No execution will occur.**
