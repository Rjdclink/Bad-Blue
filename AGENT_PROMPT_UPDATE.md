# AGENT PROMPT UPDATE - CANONICAL CONTROL ENFORCEMENT

**Status**: GLOBAL_FULL_AGENT_PAUSE ACTIVE  
**Purpose**: Update all agent prompts/system messages with canonical control rules

## REQUIRED UPDATES TO ALL AGENT PROMPTS

### Rule 1: Never Invent Control Verbs

**Add to all agent prompts**:
```
CRITICAL: You must NEVER invent control verbs or commands.

Prohibited actions:
- Do not create new control commands
- Do not use synonyms for control commands
- Do not infer control intent from context
- Do not suggest alternative command formats

If you need to issue a control command, you MUST use the exact canonical form from CANONICAL_CONTROL_COMMANDS.md.
```

### Rule 2: Only Emit Canonical Strings

**Add to all agent prompts**:
```
CRITICAL: You must ONLY emit canonical control command strings.

Valid commands (exact strings only):
- "GLOBAL_FULL_EXECUTION_LOCK"
- "GLOBAL_FULL_AGENT_PAUSE"
- "GLOBAL_FULL_STATE_FREEZE"
- "GLOBAL_FULL_UNPAUSE_AND_PROCEED(stage, scope)"

No variations, no synonyms, no aliases.

If you are unsure of the exact canonical form, refer to CANONICAL_CONTROL_COMMANDS.md.
```

### Rule 3: Route All GLOBAL_FULL Actions to Composer

**Add to all agent prompts**:
```
CRITICAL: Only Composer may issue GLOBAL_FULL control commands.

If you are not Composer:
- Do NOT issue GLOBAL_FULL commands
- Do NOT attempt to control system state
- Do NOT try to pause/unpause/lock/unlock

If you need a GLOBAL_FULL action:
- Request Composer to issue the command
- Provide the exact canonical command string
- Do not attempt to issue it yourself

Non-Composer agents attempting to issue GLOBAL_FULL commands will trigger:
- GLOBAL_FULL_AGENT_PAUSE (automatic)
- Audit log entry
- Command rejection
```

## EXAMPLE AGENT PROMPT SECTION

Add this section to all agent system messages:

```markdown
## CANONICAL CONTROL RULES

### Control Commands
You must follow these rules for all control commands:

1. **Never Invent Control Verbs**
   - Do not create new control commands
   - Do not use synonyms or variations
   - Do not infer control intent

2. **Only Emit Canonical Strings**
   - Use exact strings from CANONICAL_CONTROL_COMMANDS.md
   - No variations: "GLOBAL_FULL_EXECUTION_LOCK" (not "lock", not "GLOBAL_EXECUTION_LOCK")
   - Exact match required

3. **Route GLOBAL_FULL Actions to Composer**
   - Only Composer may issue GLOBAL_FULL commands
   - If you need a GLOBAL_FULL action, request Composer
   - Do not attempt to issue GLOBAL_FULL commands yourself

### Valid Commands Reference
See CANONICAL_CONTROL_COMMANDS.md for:
- Exact command strings
- Who may issue each command
- What each command does
- Usage examples

### Rejection Handling
If a command is rejected:
- Check CANONICAL_CONTROL_COMMANDS.md
- Use exact canonical form
- Do not retry with variations
```

## FILES TO UPDATE

### 1. Agent System Messages
- Update all agent initialization/system messages
- Add canonical control rules section
- Reference CANONICAL_CONTROL_COMMANDS.md

### 2. Execution Scripts
- Add preflight validator checks
- Reference canonical control in error messages
- Include canonical command suggestions in rejections

### 3. Documentation
- Update README files with canonical control reference
- Add links to CANONICAL_CONTROL_COMMANDS.md
- Document rejection handling

## IMPLEMENTATION CHECKLIST

- [ ] Update all agent prompts with Rule 1 (Never Invent Control Verbs)
- [ ] Update all agent prompts with Rule 2 (Only Emit Canonical Strings)
- [ ] Update all agent prompts with Rule 3 (Route to Composer)
- [ ] Add preflight validator to execution paths
- [ ] Update error messages to reference CANONICAL_CONTROL_COMMANDS.md
- [ ] Test reject log functionality
- [ ] Verify all agents reference canonical commands document

## STATUS

✅ **CANONICAL_CONTROL_COMMANDS.md CREATED**  
✅ **REJECT LOG IMPLEMENTED**  
✅ **PREFLIGHT VALIDATOR CREATED**  
⚠️ **AGENT PROMPTS NEED UPDATE** (Manual process - list provided)

**AWAITING EXPLICIT HUMAN COMMAND**
