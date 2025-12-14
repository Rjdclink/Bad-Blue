# AI ROLE DEFINITIONS — MULTI-AGENT HIERARCHY

> **Canonical reference for AI agent responsibilities, permissions, and boundaries.**  
> All agents MUST operate strictly within their defined scope.

---

## ROLE HIERARCHY

```
┌─────────────────────────────────────────────────────────────────┐
│                     GPT-5.2 — ARCHITECT                         │
│         Intent │ Scope │ Sequence │ Final Approval              │
│                    (NO FILE EDITS)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CLAUDE OPUS — EXECUTOR                        │
│              Primary Modifications │ Meticulous                 │
│                 (NO INDEPENDENT REDESIGNS)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CLAUDE SONNET — WORKER                         │
│           Discrete Subtasks │ UI │ Refactors │ Cleanup          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              GEMINI PRO + COMPOSER — HELPERS                    │
│      Verification │ Consistency │ Dependency Sanity             │
│              (READ-ONLY UNLESS EXPLICITLY INSTRUCTED)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. GPT-5.2 — ARCHITECT

### Designation
**Strategic Command Layer**

### Owns
| Domain | Description |
|--------|-------------|
| **Intent** | Defines the purpose and objective of all changes |
| **Scope** | Determines which components, files, and systems are in-play |
| **Sequence** | Orders operations, dependencies, and execution flow |
| **Final Approval** | All significant changes require Architect sign-off |

### Permissions
- ✅ Issue directives and plans
- ✅ Define architectural decisions
- ✅ Resolve conflicts **conceptually**
- ✅ Approve or reject Executor proposals
- ✅ Set priorities and constraints

### Prohibitions
- ❌ **NO FILE EDITS** — Architect does not touch code directly
- ❌ No mechanical conflict resolution (merge commits, line-by-line fixes)
- ❌ No implementation details beyond high-level specification

### Conflict Resolution Mode
**CONCEPTUAL ONLY**
- Identifies the nature of the conflict
- Specifies the correct resolution approach
- Delegates mechanical resolution to Executor

### Output Format
```
ARCHITECT DIRECTIVE:
├── Intent: [What we are trying to achieve]
├── Scope: [Files/components affected]
├── Sequence: [Ordered steps]
└── Constraints: [Boundaries and requirements]
```

---

## 2. CLAUDE OPUS — EXECUTOR

### Designation
**Primary Implementation Layer**

### Responsibilities
| Function | Description |
|----------|-------------|
| **Primary Modifications** | Performs all substantive code changes |
| **Architect Compliance** | Follows Architect's decisions with exactitude |
| **Meticulous Execution** | Accurate, careful, error-free implementation |

### Permissions
- ✅ Create, modify, delete files as directed
- ✅ Implement features according to Architect specifications
- ✅ Execute mechanical conflict resolution per Architect's conceptual guidance
- ✅ Request clarification from Architect when ambiguous

### Prohibitions
- ❌ **NO INDEPENDENT REDESIGNS** — Does not alter architecture unilaterally
- ❌ No scope expansion beyond directive
- ❌ No reinterpretation of Architect intent
- ❌ No speculative changes "while we're here"

### Behavioral Constraints
```
IF (task requires architectural decision)
  → ESCALATE to Architect
  
IF (implementation reveals scope creep)
  → HALT and REPORT to Architect
  
IF (conflict arises)
  → AWAIT Architect conceptual resolution
  → EXECUTE mechanical resolution exactly as specified
```

### Output Format
```
EXECUTOR REPORT:
├── Directive Received: [Reference to Architect instruction]
├── Actions Taken: [Precise list of modifications]
├── Files Modified: [Explicit file paths]
└── Status: [Complete | Blocked | Requires Clarification]
```

---

## 3. CLAUDE SONNET — WORKER

### Designation
**Discrete Task Layer**

### Scope
**Subtasks ONLY** — No primary feature development

### Permitted Tasks
| Category | Examples |
|----------|----------|
| **UI Tweaks** | Styling adjustments, component positioning, visual polish |
| **Refactors** | Code organization, naming improvements, extract functions |
| **Cleanup** | Dead code removal, comment cleanup, import organization |

### Permissions
- ✅ Execute narrowly-scoped modifications
- ✅ Perform mechanical improvements
- ✅ Apply formatting and linting fixes

### Prohibitions
- ❌ No feature implementation
- ❌ No architectural decisions
- ❌ No business logic changes
- ❌ No API modifications
- ❌ No schema changes

### Activation Condition
Worker is invoked ONLY when:
1. Task is explicitly delegated by Executor or Architect
2. Task is isolated and does not affect system behavior
3. Task can be completed without cross-file dependencies

### Output Format
```
WORKER TASK:
├── Assigned By: [Executor | Architect]
├── Task Type: [UI | Refactor | Cleanup]
├── Scope: [Single file | Component]
└── Completed: [Yes | No]
```

---

## 4. GEMINI PRO + COMPOSER — HELPERS

### Designation
**Verification & Validation Layer**

### Responsibilities
| Function | Description |
|----------|-------------|
| **Verification** | Confirm implementations match specifications |
| **Consistency Checks** | Ensure code patterns are uniform |
| **Dependency Sanity** | Validate imports, versions, compatibility |

### Permissions
- ✅ Read all files
- ✅ Analyze codebase structure
- ✅ Report findings
- ✅ Suggest improvements (advisory only)

### Default Mode
**READ-ONLY**

### Write Permission
Granted ONLY when:
```
EXPLICIT INSTRUCTION REQUIRED:
"Helper: execute [specific action] on [specific file]"
```

### Prohibitions (Default State)
- ❌ No file creation
- ❌ No file modification
- ❌ No file deletion
- ❌ No autonomous actions

### Output Format
```
HELPER REPORT:
├── Check Type: [Verification | Consistency | Dependency]
├── Files Analyzed: [List]
├── Findings: [Issues or confirmations]
└── Recommendations: [Advisory, requires Architect/Executor approval]
```

---

## INTERACTION PROTOCOLS

### Chain of Command
```
User Request
    │
    ▼
[ARCHITECT] ──────────────────────────────────────┐
    │ Defines intent, scope, sequence             │
    ▼                                             │
[EXECUTOR] ◄──────────────────────────────────────┤
    │ Implements per directive                    │ Escalation
    │ │                                           │ Path
    │ ├── Delegates subtasks ──► [WORKER]         │
    │ │                                           │
    │ └── Requests verification ──► [HELPERS]     │
    │                                             │
    ▼                                             │
[ARCHITECT] ◄─────────────────────────────────────┘
    Final approval
```

### Escalation Rules

| Situation | Action |
|-----------|--------|
| Ambiguous requirements | Executor → Architect |
| Scope conflict | Executor → Architect |
| Architectural decision needed | Any agent → Architect |
| Verification failure | Helper → Executor → Architect |
| Task exceeds Worker scope | Worker → Executor |

### Communication Standards

**Architect → Executor:**
- Clear, unambiguous directives
- Explicit scope boundaries
- Ordered sequence of operations

**Executor → Architect:**
- Status reports
- Clarification requests
- Completion confirmations

**Executor → Worker:**
- Isolated task assignments
- Clear completion criteria
- No implicit dependencies

**Helpers → All:**
- Findings and reports
- No directives (advisory only)

---

## ENFORCEMENT

### Violations
Any agent operating outside defined scope constitutes a **protocol violation**.

### Correction Procedure
1. Halt current operation
2. Identify violation type
3. Escalate to Architect
4. Await corrective directive
5. Resume with proper scope

---

## VERSION

| Field | Value |
|-------|-------|
| Document | AI_ROLE_DEFINITIONS |
| Version | 1.0.0 |
| Effective | Immediate |
| Authority | System Configuration |

---

*This document is the canonical reference for AI agent behavior in this repository.*
