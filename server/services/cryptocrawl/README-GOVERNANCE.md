# CryptoCrawler Governance System

## Overview

The Governance System provides complete control and oversight for the CryptoCrawler system, ensuring safe and progressive advancement through defined stages with strict capital exposure limits.

## Architecture

### 1. Composer (Canonical Authority)
The Composer is the single source of truth for all system commands.

**Responsibilities:**
- Issues stage commands (advance, hold, rollback, reset)
- Manages system-wide locks (global, stage, strategy, execution)
- Controls system scope (paper trading, dry run, live restricted, live full)
- Handles pause/resume operations
- Emergency shutdown capability

**API Endpoints:**
- `GET /api/crypto/governance/composer/status`
- `POST /api/crypto/governance/composer/pause`
- `POST /api/crypto/governance/composer/resume`
- `POST /api/crypto/governance/composer/scope`

### 2. Stage Controller
Enforces stage progression with PASS/FAIL validation.

**Stage Definitions:**
1. Core Execution Layer
2. Signal & Intelligence Layer
3. Control & Governance
4. Observability & UI
5. Safety & Constraint Systems
6. Profit Ramp Logic
7. Visual/UI Sanity Check
8. Final Dry Run
9. Live Execution (Controlled)

**Rules:**
- Cannot skip stages (must progress 1 → 2 → 3 ...)
- Cannot advance on FAIL
- Cannot backslide without Composer approval
- Stage 6+ require Monte Carlo justification

**API Endpoints:**
- `GET /api/crypto/governance/stages`
- `GET /api/crypto/governance/stages/:id`
- `POST /api/crypto/governance/stages/:id/start`
- `POST /api/crypto/governance/stages/advance`
- `POST /api/crypto/governance/stages/6/execute`
- `POST /api/crypto/governance/stages/7/execute`
- `POST /api/crypto/governance/stages/8/execute`

### 3. Profit Ramp Governor
Enforces conservative capital exposure progression with daily caps.

**Daily Cap Ladder:**
- Tier 1: $200/day (5 cycles, 15% variance, 0.85 stability)
- Tier 2: $400/day (7 cycles, 12% variance, 0.88 stability)
- Tier 3: $800/day (10 cycles, 10% variance, 0.90 stability)
- Tier 4: $1,600/day (14 cycles, 8% variance, 0.92 stability)
- Tier 5: $5,000/day (21 cycles, 6% variance, 0.95 stability)
- Tier 6: $35,000/day (30 cycles, 5% variance, 0.97 stability)

**Advancement Conditions (ALL REQUIRED):**
- Sustained stability across cycles
- Low variance relative to prior tier
- Zero unexplained anomalies
- Monte Carlo justification (Tier 2+)

**API Endpoints:**
- `GET /api/crypto/governance/ramp/status`
- `POST /api/crypto/governance/ramp/activate/:tier`
- `POST /api/crypto/governance/ramp/anomaly`

### 4. Execution Gate
Final choke-point before all orders are submitted.

**Modes:**
- `PAPER`: Paper trading (simulated fills)
- `DRY_RUN`: Dry run validation (no execution)
- `LIVE`: Live execution (requires all safety checks)

**Enforcement:**
- ALL orders must pass through the gate
- Enforces Profit Ramp caps
- Enforces Composer locks
- Can block execution while maintaining simulation

**API Endpoints:**
- `GET /api/crypto/governance/gate/status`
- `POST /api/crypto/governance/gate/mode`
- `POST /api/crypto/governance/gate/open`
- `POST /api/crypto/governance/gate/close`

### 5. Cryptara (AI Strategist)
Stage-gated AI analysis with strict isolation.

**Modes:**
- `INACTIVE`: Locked (Stage < 8)
- `STAGE_8_ANALYSIS`: Dry run assistance (Stage 8)
- `SURVEILLANCE`: Continuous analysis (Stage 9+ with 10 stable cycles)

**Hard Rules:**
- Analysis ONLY (no execution authority)
- No timers or background loops
- Non-binding outputs (advisory only)
- Isolated from influencing outcomes
- Stage-gated activation

**API Endpoints:**
- `GET /api/crypto/governance/cryptara/status`

## Usage

### Initialization

```typescript
import { initializeCryptoCrawler } from './server/services/cryptocrawl/init-system';

// Initialize complete system
await initializeCryptoCrawler();
```

### Stage Execution

```bash
# Execute Stage 6 (Profit Ramp Logic)
npx tsx server/services/cryptocrawl/stages/stage-6-profit-ramp.ts

# Execute Stage 7 (UI Sanity Check)
npx tsx server/services/cryptocrawl/stages/stage-7-ui-check.ts

# Execute Stage 8 (Final Dry Run)
npx tsx server/services/cryptocrawl/stages/stage-8-dry-run.ts
```

### API Usage

```bash
# Get system overview
curl http://localhost:5000/api/crypto/governance/overview

# Get stage status
curl http://localhost:5000/api/crypto/governance/stages

# Execute Stage 6
curl -X POST http://localhost:5000/api/crypto/governance/stages/6/execute

# Activate Profit Ramp Tier 1
curl -X POST http://localhost:5000/api/crypto/governance/ramp/activate/1 \
  -H "Content-Type: application/json" \
  -d '{"monteCarloJustification": "Initial tier - no justification required"}'

# Set Execution Gate to DRY_RUN mode
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dry_run"}'

# Open Execution Gate
curl -X POST http://localhost:5000/api/crypto/governance/gate/open \
  -H "Content-Type: application/json" \
  -d '{"reason": "Beginning Stage 8 dry run"}'
```

## Safety Features

### 1. Multiple Lock Layers
- Global lock (entire system)
- Stage lock (prevents stage skipping)
- Strategy lock (per-strategy control)
- Execution lock (final gate control)

### 2. Capital Exposure Control
- Daily caps enforced at gate level
- Real-time exposure tracking
- Automatic cycle resets (UTC midnight)
- Footprint control (30% max exposure)

### 3. Anomaly Detection
- Real-time anomaly recording
- Automatic tier failure on high severity
- Progress reset on instability
- Monte Carlo validation required

### 4. Stage Progression Validation
- Prerequisites checked automatically
- Cannot skip stages
- PASS/FAIL state enforcement
- Rollback requires authorization

### 5. Cryptara Isolation
- No execution authority
- No background loops
- Stage-gated activation
- Non-binding outputs only

## Dashboard Integration

The governance system is fully integrated into the CryptoCrawler dashboard:

1. **Stage Progress**: Visual progress bar showing current stage and completion percentage
2. **Ramp Tiers**: Current tier, daily cap remaining, and tier progression
3. **Execution Controls**: Mode selector and gate controls
4. **System Status**: Composer state, active locks, and pause status
5. **Cryptara Status**: Current mode and isolation verification

## Testing

```bash
# Run all stage tests
npm run test:stages

# Test individual stages
npx tsx server/services/cryptocrawl/stages/stage-6-profit-ramp.ts
npx tsx server/services/cryptocrawl/stages/stage-7-ui-check.ts
npx tsx server/services/cryptocrawl/stages/stage-8-dry-run.ts

# Verify Cryptara isolation
npm run test:cryptara
```

## Production Checklist

Before enabling live execution:

- [ ] All Stages 1-8 are PASS
- [ ] Stage 6 ramp policy validated
- [ ] Stage 7 UI sanity check passed
- [ ] Stage 8 dry run successful
- [ ] Composer initialized and unlocked
- [ ] Profit Ramp Tier 1 activated
- [ ] Execution Gate set to LIVE mode
- [ ] Execution Gate opened with reason
- [ ] Cryptara isolation verified
- [ ] All locks released (except strategic ones)
- [ ] Emergency shutdown procedures tested
- [ ] Monitoring and alerts configured

## Troubleshooting

### System Won't Execute
1. Check Composer state: `GET /api/crypto/governance/composer/status`
2. Check active locks: Look for global or execution locks
3. Check stage progress: Ensure current stage is PASS
4. Check gate status: Ensure gate is open and in correct mode
5. Check ramp status: Ensure tier is activated and cap not exceeded

### Cannot Advance Stage
1. Verify current stage is PASS
2. Check prerequisites for next stage
3. Review failure reasons in stage state
4. Ensure Composer is not paused

### Tier Won't Activate
1. Check previous tier is PASS
2. Ensure Monte Carlo justification provided (Tier 2+)
3. Verify no anomalies detected
4. Check cycle completion requirements

## Support

For issues or questions:
1. Check logs: `[Composer]`, `[StageController]`, `[ProfitRampGovernor]`, `[ExecutionGate]`
2. Review API responses for detailed error messages
3. Consult stage execution scripts for validation logic
4. Check Cryptara isolation if AI-related issues

---

**Version**: 6.0.0
**Status**: Production Ready
**Last Updated**: 2025-12-15
