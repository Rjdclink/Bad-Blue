# Master Password Implementation - Three-Tier Access System

## Overview
This document describes the implementation of the three-tier master password system that provides isolated access to different platform zones.

## The Three Master Passwords

### Zone A: LegalWhat User Access
- **Password**: `SARBEAR`
- **Role**: `LEGALWHAT_ROOT`
- **Route**: `/legalwhat/home`
- **AI Mode**: `legal`
- **Purpose**:
  - Grants entry to the LegalWhat platform interface
  - Activates the AI subsystem governing legal operations
  - Allows AIs to visualize, optimize, enhance, and manage all LegalWhat functions
  - Enables the filing system, autosave restoration, consultation modules, and all legal tools

### Zone B: 4JI Orchestrator Admin Console
- **Password**: `FORGEAI`
- **Role**: `ORCHESTRATOR_ADMIN`
- **Route**: `/4ji/orchestrator`
- **AI Mode**: `orchestrator`
- **Purpose**:
  - Grants access to the 4JI control console
  - Controls the merged entity containing all 13+ models unified into a single adaptive intelligence layer
  - Manages orchestration, scheduling, optimization cycles, subsystem diagnostics
  - Runs both the Worker Engine and the Sub-Agent Execution Engine
  - Governs system-wide directives

### Zone C: CryptoCrawler Dashboard Access
- **Password**: `CRPTCRWLR`
- **Role**: `CRAWLER_ROOT`
- **Route**: `/cryptocrawler/dashboard`
- **AI Mode**: `crypto`
- **Purpose**:
  - Full access to the CryptoCrawler control panel
  - Controls Monte Carlo simulations
  - Controls the trading faucet system
  - Runs deep-market crawling, autonomous strategy evolution
  - Manages multi-source signal fusion
  - Uses separate learning + evolving Supabase tables

## System Rules

### 1. No Email Required
All three access levels authenticate purely by password:
- No email field required
- No username field required
- No account lookup required
- Password → direct access

### 2. Physical Isolation
Each password unlocks a different environment:
- Each zone has its own route
- Each zone has its own UI
- Each zone has its own state container
- Cross-zone access is blocked

### 3. Domain Isolation (4JI)
Even though all intelligence is merged into 4JI, domains remain isolated:

```
IF 4ji.current_mode == 'legal':
    ONLY LegalWhat systems may be read, altered, optimized, or evolved

IF 4ji.current_mode == 'crypto':
    ONLY CryptoCrawler systems may be read, altered, optimized, or evolved
```

### 4. Memory Table Isolation
Each domain has separate tables:
- `learning_legal`, `evolving_legal` (Legal Domain)
- `learning_crypto`, `evolving_crypto` (Crypto Domain)

Flow Rule: `learning_* → evolving_*` (NEVER cross between legal and crypto tables)

## Scheduled Operations (CST)

### Nightly Optimization Window
- **Start**: 1:30 CST
- **End**: 3:30 CST
- **Task**: Full-platform optimization

### Monte Carlo Window
- **Start**: 3:30 CST
- **End**: 5:30 CST
- **Task**: Continuous Monte Carlo training cycles

### Immediate On-Demand Issue Repair
```
IF error_detected:
    4ji.research_fix()
    4ji.apply_fix(live_patch=True, redeploy=False)
    4ji.verify_fix()
```

## API Response Format

When using master passwords, the login endpoint returns:

```json
{
  "success": true,
  "message": "Login successful",
  "isMasterBypass": true,
  "hasActiveSubscription": true,
  "accessZone": "legalwhat|orchestrator|cryptocrawler",
  "accessRole": "LEGALWHAT_ROOT|ORCHESTRATOR_ADMIN|CRAWLER_ROOT",
  "redirectRoute": "/legalwhat/home|/4ji/orchestrator|/cryptocrawler/dashboard",
  "aiMode": "legal|orchestrator|crypto"
}
```

## Usage Examples

### Example 1: LegalWhat Access
```bash
POST /api/login/local
{
  "password": "SARBEAR"
}
```
**Result**: Redirected to `/legalwhat/home` with `LEGALWHAT_ROOT` role

### Example 2: 4JI Orchestrator Access
```bash
POST /api/login/local
{
  "password": "FORGEAI"
}
```
**Result**: Redirected to `/4ji/orchestrator` with `ORCHESTRATOR_ADMIN` role

### Example 3: CryptoCrawler Access
```bash
POST /api/login/local
{
  "password": "CRPTCRWLR"
}
```
**Result**: Redirected to `/cryptocrawler/dashboard` with `CRAWLER_ROOT` role

## Security Considerations

### By Design
- Master passwords are hardcoded (as required)
- Each bypasses payment requirements
- Each bypasses rate limiting (intentional)
- Works without email (as required)

### Security Measures
- All usage is logged with security alerts and timestamps
- Unique user IDs per zone per email (if provided)
- Proper session management
- Domain isolation prevents cross-zone data access

## Integration Points

The master password system integrates with:
1. **Authentication System**: Passport local strategy
2. **User Management**: storage.upsertUser()
3. **Payment System**: storage.updateUserAccess()
4. **Session Management**: req.login()
5. **Database**: Zone-specific Supabase tables

## Active System Integrations

All previously defined integrations remain in full force:
- TradingView
- Alchemy
- Monte Carlo Engine
- Multi-model orchestration
- Error scanners
- Self-healers
- Crawlers
- Legal filing engines
- Autosave + Supabase storage
- Full coding autonomy
- UI optimization tools
- Data fusion layer
- Offline heuristic core

