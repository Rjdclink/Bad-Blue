# COMMAND REJECTION REPORT

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Command Attempted**: `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: ...)`  
**Result**: ❌ REJECTED - Not in canonical form

## REJECTION REASON

The command does not match the canonical form required by `CANONICAL_CONTROL_COMMANDS.md`.

### Issues with Command

1. **Missing `AND_PROCEED`**: Command says `GLOBAL_FULL_UNPAUSE` but should be `GLOBAL_FULL_UNPAUSE_AND_PROCEED`
2. **Incorrect Format**: Uses `(STAGE-5 scope: ...)` but should be `(stage_number, scope_string)`
3. **Not Exact Match**: Does not match exact canonical string format

### User's Command
```
GLOBAL_FULL_UNPAUSE (STAGE-5 scope: single exchange, single pair, micro size, maker-only, auto pause on completion
```

### Required Canonical Form
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

## CORRECT CANONICAL COMMAND

**Exact String** (copy/paste this):
```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

**Format**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)`

**Parameters**:
- Stage: `5`
- Scope: `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion`

## REJECT LOG ENTRY

This command will be logged in the reject log with:
- Raw Input: `GLOBAL_FULL_UNPAUSE (STAGE-5 scope: ...)`
- Rejection Reason: `Command does not match canonical form. Must use exact canonical form.`
- Canonical Replacement: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)`

## STATUS

❌ **COMMAND REJECTED**  
✅ **CANONICAL FORM PROVIDED**  
⏸️ **GLOBAL_FULL_AGENT_PAUSE REMAINS ACTIVE**

**AWAITING CORRECT CANONICAL COMMAND**
