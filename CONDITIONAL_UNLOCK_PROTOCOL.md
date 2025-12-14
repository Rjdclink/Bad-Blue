# CONDITIONAL UNLOCK PROTOCOL

## MECHANISM

**Conditional unlock** means:
- System may be unlocked for a specific stage/task/scope
- Upon completion of that phase, ALL agents automatically pause
- Hard-lock immediately resumes
- System returns to LOCKED state until next explicit unpause command

## AUTOMATIC PAUSE TRIGGERS

The following events trigger automatic pause and hard-lock resumption:

1. **Stage completion** - When a stage's required output is produced and marked PASS/FAIL
2. **Task completion** - When the assigned task is finished
3. **Phase boundary** - When transitioning between phases
4. **Gate failure** - When any gate (Monte Carlo, Risk Governor, etc.) fails

## ENFORCEMENT

- Composer monitors all agent activity
- Upon detection of phase completion, Composer immediately:
  1. Issues PAUSE command to all agents
  2. Resumes hard-lock
  3. Sets UNPAUSE = FALSE
  4. Sets GLOBAL_EXECUTION = DISABLED
  5. Reports completion status

## STATUS TRACKING

After each automatic pause, status will show:
- **Previous Stage**: [completed stage number]
- **Completion Status**: PASS/FAIL
- **Current Status**: 🔒 LOCKED
- **Next Required**: Explicit UNPAUSE command with stage, task, scope

---

**Status**: ACTIVE
**Enforcement**: AUTOMATIC
**Authority**: Composer
