# CANONICAL UNPAUSE COMMAND - EXACT TEXT

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Command Type**: Re-issued Canonical Unpause  
**Stage**: 5  
**Scope**: single exchange, single pair, micro size  
**Constraint**: auto-pause on completion

## EXACT CANONICAL COMMAND

**Copy/Paste This Exact Text** (case-sensitive, no variations):

```
GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion)
```

## COMMAND BREAKDOWN

**Command Name**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED`

**Stage Parameter**: `5` (number, not "STAGE-5")

**Scope Parameter**: `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion`

**Format**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)`

## VALIDATION

- ✅ Includes `GLOBAL`
- ✅ Includes `FULL`
- ✅ Includes `AND_PROCEED`
- ✅ Format: `(stage, scope)` with number and string
- ✅ Exact match to canonical form
- ✅ No synonyms or variations

## WHO MAY ISSUE

**Composer-only** - Only Composer may issue this command.

**Enforcement**: `issuer === 'composer'` check in `canonical-control.ts`

## WHAT IT DOES

1. Unpauses all locked states
2. Unlocks execution
3. Unpauses agents
4. Unfreezes state
5. Sets explicit stage: `5`
6. Sets explicit scope: `single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion`
7. Allows execution to proceed with specified scope

## STATE CHANGES

- `executionLock: false`
- `agentPause: false`
- `stateFreeze: false`
- `unpauseStage: 5`
- `unpauseScope: "single exchange uniswap-v3 single pair LINK/USDT micro size maker-only auto-pause on completion"`

## STATUS

⏸️ **GLOBAL_FULL_AGENT_PAUSE ACTIVE**  
✅ **CANONICAL COMMAND PROVIDED**  
⏳ **AWAITING COMMAND ISSUANCE**
