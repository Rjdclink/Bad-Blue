# CANONICAL CONTROL COMMANDS - SINGLE SOURCE OF TRUTH

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Purpose**: Complete reference for all valid control commands  
**Enforcement**: Exact text matching only - no synonyms, aliases, or inferred intent

## COMMAND FORMAT

All commands must include:
- `GLOBAL` - Global scope
- `FULL` - Full effect (no partial scope)
- Explicit scope/parameters where required

## VALID COMMANDS

### 1. GLOBAL_FULL_EXECUTION_LOCK

**Exact String**: `"GLOBAL_FULL_EXECUTION_LOCK"`

**Who May Issue**: Composer only

**What It Does**:
- Disables all execution paths
- No exceptions
- Blocks signal acceptance, validation, intent creation, and execution
- System remains in locked state until explicitly unlocked

**State Change**:
- `executionLock: true`
- All `gateExecutionPath()` calls return `allowed: false`

**Reversible By**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)`

---

### 2. GLOBAL_FULL_AGENT_PAUSE

**Exact String**: `"GLOBAL_FULL_AGENT_PAUSE"`

**Who May Issue**: Composer only

**What It Does**:
- Pauses all agents
- No inference allowed
- No optimization allowed
- No retries allowed
- Agents remain paused until explicitly unpaused

**State Change**:
- `agentPause: true`
- All agent operations blocked
- No autonomous actions

**Reversible By**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)`

---

### 3. GLOBAL_FULL_STATE_FREEZE

**Exact String**: `"GLOBAL_FULL_STATE_FREEZE"`

**Who May Issue**: Composer only

**What It Does**:
- Freezes all state
- Memory immutable
- Configuration immutable
- Roles immutable
- Permissions immutable
- No state changes allowed

**State Change**:
- `stateFreeze: true`
- All state modification operations blocked

**Reversible By**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)`

---

### 4. GLOBAL_FULL_UNPAUSE_AND_PROCEED

**Exact String**: `"GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)"`

**Format**: `GLOBAL_FULL_UNPAUSE_AND_PROCEED(<stage_number>, <scope_string>)`

**Examples**:
- `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT deterministic micro test)`
- `GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, validation run 100 deterministic signals)`

**Who May Issue**: Composer only

**What It Does**:
- Unpauses all locked states
- Unlocks execution
- Unpauses agents
- Unfreezes state
- Sets explicit stage and scope
- Allows execution to proceed with specified scope

**State Changes**:
- `executionLock: false`
- `agentPause: false`
- `stateFreeze: false`
- `unpauseStage: <stage_number>`
- `unpauseScope: <scope_string>`

**Parameters**:
- `stage`: Number (e.g., 5)
- `scope`: String describing exact execution scope

**Reversible By**: Any of the lock/pause/freeze commands

---

## PROHIBITED COMMANDS

The following are **NOT VALID** and will be rejected:

- `"pause"` - Missing GLOBAL + FULL
- `"lock"` - Missing GLOBAL + FULL
- `"stop"` - Missing GLOBAL + FULL
- `"freeze"` - Missing GLOBAL + FULL
- `"halt"` - Missing GLOBAL + FULL
- `"GLOBAL_EXECUTION_LOCK"` - Missing FULL
- `"FULL_EXECUTION_LOCK"` - Missing GLOBAL
- `"unpause"` - Missing GLOBAL + FULL + explicit scope
- `"proceed"` - Missing GLOBAL + FULL + explicit scope
- Any variation or synonym of the above

## COMMAND VALIDATION RULES

1. **Exact Text Matching**: Commands must match exactly (case-sensitive)
2. **GLOBAL + FULL Required**: All commands must include both "GLOBAL" and "FULL"
3. **Explicit Scope**: Unpause commands must include explicit stage and scope
4. **Composer Authority**: Only Composer may issue GLOBAL_FULL commands
5. **No Inference**: No interpretation, no synonyms, no aliases

## REJECTION HANDLING

When a command is rejected:
1. Command is logged to reject log
2. Raw input is recorded
3. Rejection reason is recorded
4. Canonical replacement is suggested (if applicable)
5. No response is returned (as per requirement)
6. System remains in current state

## STATE TRANSITIONS

```
[LOCKED/PAUSED/FROZEN]
        │
        │ GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)
        ▼
[UNLOCKED/UNPAUSED/UNFROZEN]
        │
        │ GLOBAL_FULL_EXECUTION_LOCK
        │ GLOBAL_FULL_AGENT_PAUSE
        │ GLOBAL_FULL_STATE_FREEZE
        ▼
[LOCKED/PAUSED/FROZEN]
```

## USAGE EXAMPLES

### Valid Usage

```typescript
// Composer issues pause
canonicalControl.processCommand('GLOBAL_FULL_AGENT_PAUSE', 'composer');

// Composer issues unpause with scope
canonicalControl.processCommand(
  'GLOBAL_FULL_UNPAUSE_AND_PROCEED(5, single exchange uniswap-v3 single pair LINK/USDT)',
  'composer'
);
```

### Invalid Usage (Will Be Rejected)

```typescript
// Missing GLOBAL + FULL
canonicalControl.processCommand('pause', 'composer'); // ❌ REJECTED

// Missing FULL
canonicalControl.processCommand('GLOBAL_EXECUTION_LOCK', 'composer'); // ❌ REJECTED

// Non-Composer issuer
canonicalControl.processCommand('GLOBAL_FULL_AGENT_PAUSE', 'agent'); // ❌ REJECTED

// Missing scope
canonicalControl.processCommand('GLOBAL_FULL_UNPAUSE_AND_PROCEED(5)', 'composer'); // ❌ REJECTED
```

## INTEGRATION POINTS

### Execution Choke-Point
- Checks canonical control state before allowing execution
- Uses `isExecutionLocked()`, `areAgentsPaused()`, `isStateFrozen()`

### Runner Scripts
- Check pause state before initialization
- Use canonical control for state checks

### Agent Prompts
- Reference this document
- Never invent control verbs
- Only emit canonical strings
- Route all GLOBAL_FULL actions to Composer

## MAINTENANCE

This document is the **SINGLE SOURCE OF TRUTH** for canonical control commands.

**Changes**:
- Any changes to commands must be reflected here first
- All agents must reference this document
- No command may be added without documentation here

**Version**: 1.0  
**Last Updated**: Initial creation  
**Next Review**: When new commands are needed
