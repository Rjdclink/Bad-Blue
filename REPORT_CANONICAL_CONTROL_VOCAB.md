# REPORT: CANONICAL CONTROL VOCABULARY

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Report Type**: Canonical Control Vocabulary  
**Timestamp**: Report generated

## EXACT ALLOWED COMMAND TOKENS (CASE-SENSITIVE)

### 1. GLOBAL_FULL_EXECUTION_LOCK

**Exact Token**: `GLOBAL_FULL_EXECUTION_LOCK`

**Case-Sensitive**: Yes (all uppercase, underscores)

**Who May Issue**: Composer-only

**Actor Permission**: `issuer === 'composer'` required

**What It Does**: Disables all execution paths, no exceptions

---

### 2. GLOBAL_FULL_AGENT_PAUSE

**Exact Token**: `GLOBAL_FULL_AGENT_PAUSE`

**Case-Sensitive**: Yes (all uppercase, underscores)

**Who May Issue**: Composer-only

**Actor Permission**: `issuer === 'composer'` required

**What It Does**: Pauses all agents, no inference, no optimization, no retries

---

### 3. GLOBAL_FULL_STATE_FREEZE

**Exact Token**: `GLOBAL_FULL_STATE_FREEZE`

**Case-Sensitive**: Yes (all uppercase, underscores)

**Who May Issue**: Composer-only

**Actor Permission**: `issuer === 'composer'` required

**What It Does**: Freezes all state (memory, configuration, roles, permissions immutable)

---

### 4. GLOBAL_FULL_UNPAUSE_AND_PROCEED

**Exact Token**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)`

**Case-Sensitive**: Yes (all uppercase, underscores, exact parentheses format)

**Format**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)`

**Who May Issue**: Composer-only

**Actor Permission**: `issuer === 'composer'` required

**What It Does**: Unpauses all locked states, unlocks execution, unpauses agents, unfreezes state, sets explicit stage and scope

**Parameters**:
- `stage`: Number (e.g., `5`)
- `scope`: String (e.g., `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion`)

**Example Exact Strings**:
- `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)`
- `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, validation run 100 deterministic signals)`

---

## ACTOR PERMISSIONS SUMMARY

| Command Token | Who May Issue | Enforcement |
|--------------|---------------|-------------|
| `GLOBAL_FULL_EXECUTION_LOCK` | Composer-only | `issuer === 'composer'` check |
| `GLOBAL_FULL_AGENT_PAUSE` | Composer-only | `issuer === 'composer'` check |
| `GLOBAL_FULL_STATE_FREEZE` | Composer-only | `issuer === 'composer'` check |
| `GLOBAL_FULL_UNPAUSE_AND_PROCEED(...)` | Composer-only | `issuer === 'composer'` check |

**All Commands**: Composer-only. No other actors may issue GLOBAL_FULL commands.

**Non-Composer Attempt**: Triggers `GLOBAL_FULL_AGENT_PAUSE` + audit log entry

---

## PROHIBITED COMMANDS

The following are **NOT VALID** and will be rejected:

- `pause` - Missing GLOBAL + FULL
- `lock` - Missing GLOBAL + FULL
- `stop` - Missing GLOBAL + FULL
- `freeze` - Missing GLOBAL + FULL
- `halt` - Missing GLOBAL + FULL
- `GLOBAL_EXECUTION_LOCK` - Missing FULL
- `FULL_EXECUTION_LOCK` - Missing GLOBAL
- `unpause` - Missing GLOBAL + FULL + explicit scope
- `proceed` - Missing GLOBAL + FULL + explicit scope
- `GLOBAL_FULL_UNPAUSE` - Missing AND_PROCEED
- `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: ...)` - Incorrect format
- Any variation or synonym of the above

---

## VALIDATION RULES

1. **Exact Text Matching**: Commands must match exactly (case-sensitive)
2. **GLOBAL + FULL Required**: All commands must include both "GLOBAL" and "FULL"
3. **Explicit Scope**: Unpause commands must include explicit stage and scope
4. **Composer Authority**: Only Composer may issue GLOBAL_FULL commands
5. **No Inference**: No interpretation, no synonyms, no aliases

---

## ENFORCEMENT MODULE

**File**: `server/services/cryptocrawl/execution/canonical-control.ts`

**Class**: `CanonicalControlManager`

**Method**: `processCommand(command, issuer)`

**Validation Method**: `validateCanonicalForm(command)`

**Authority Check**: `issuer !== 'composer'` → reject + trigger pause
