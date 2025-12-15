# CryptoCrawler Governance System - Quick Start Guide

## 🚀 5-Minute Setup

### 1. Initialize the System

```typescript
import { initializeCryptoCrawler } from './server/services/cryptocrawl/init-system';

// Initialize complete governance system
await initializeCryptoCrawler();
```

**What this does**:
- ✅ Initializes Composer (canonical authority)
- ✅ Initializes Stage Controller (PASS/FAIL enforcement)
- ✅ Initializes Profit Ramp Governor (daily caps)
- ✅ Initializes Execution Gate (final choke-point)
- ✅ Initializes Signal Layer (Faucet + Mesh)

---

## 📋 Execute Stages 6-8

### Stage 6: Profit Ramp Logic

```bash
# CLI
npx tsx server/services/cryptocrawl/stages/stage-6-profit-ramp.ts

# OR via API
curl -X POST http://localhost:5000/api/crypto/governance/stages/6/execute
```

**Output**: RAMP POLICY table with 6 tiers ($200 → $35k)

### Stage 7: UI Sanity Check

```bash
# CLI
npx tsx server/services/cryptocrawl/stages/stage-7-ui-check.ts

# OR via API
curl -X POST http://localhost:5000/api/crypto/governance/stages/7/execute
```

**Output**: UI CONFIRMATION report

### Stage 8: Final Dry Run

```bash
# CLI
npx tsx server/services/cryptocrawl/stages/stage-8-dry-run.ts

# OR via API
curl -X POST http://localhost:5000/api/crypto/governance/stages/8/execute
```

**Output**: PASS/FAIL with complete flow validation

---

## 🎮 Control System via API

### Get Complete Status

```bash
curl http://localhost:5000/api/crypto/governance/overview
```

### Activate Profit Ramp Tier 1

```bash
curl -X POST http://localhost:5000/api/crypto/governance/ramp/activate/1 \
  -H "Content-Type: application/json" \
  -d '{"monteCarloJustification": "Initial tier - no justification required"}'
```

### Set Execution Mode

```bash
# Paper Trading (simulated)
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "paper"}'

# Dry Run (validation only)
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dry_run"}'

# Live (real execution)
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "live"}'
```

### Open Execution Gate

```bash
curl -X POST http://localhost:5000/api/crypto/governance/gate/open \
  -H "Content-Type: application/json" \
  -d '{"reason": "Beginning Stage 8 dry run"}'
```

### Close Execution Gate

```bash
curl -X POST http://localhost:5000/api/crypto/governance/gate/close \
  -H "Content-Type: application/json" \
  -d '{"reason": "End of trading day"}'
```

---

## 📊 Monitor System Status

### View All Stages

```bash
curl http://localhost:5000/api/crypto/governance/stages
```

### View Profit Ramp Status

```bash
curl http://localhost:5000/api/crypto/governance/ramp/status
```

### View Execution Gate Status

```bash
curl http://localhost:5000/api/crypto/governance/gate/status
```

### View Cryptara Status

```bash
curl http://localhost:5000/api/crypto/governance/cryptara/status
```

---

## 🛡️ Safety Controls

### Pause System

```bash
curl -X POST http://localhost:5000/api/crypto/governance/composer/pause \
  -H "Content-Type: application/json" \
  -d '{"reason": "Maintenance"}'
```

### Resume System

```bash
curl -X POST http://localhost:5000/api/crypto/governance/composer/resume
```

### Record Anomaly

```bash
curl -X POST http://localhost:5000/api/crypto/governance/ramp/anomaly \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Unexpected price movement",
    "severity": "medium"
  }'
```

**Severity levels**: `low`, `medium`, `high`
**Note**: `high` severity automatically fails the current tier

---

## 🎯 Daily Cap Ladder

| Tier | Daily Cap | Cycles | Max Variance | Required Stability |
|------|-----------|--------|--------------|-------------------|
| 1    | $200      | 5      | 15%          | 0.85              |
| 2    | $400      | 7      | 12%          | 0.88              |
| 3    | $800      | 10     | 10%          | 0.90              |
| 4    | $1,600    | 14     | 8%           | 0.92              |
| 5    | $5,000    | 21     | 6%           | 0.95              |
| 6    | $35,000   | 30     | 5%           | 0.97              |

**Advancement Requirements** (ALL must be met):
- ✅ Complete required cycles
- ✅ Variance below maximum
- ✅ Stability above requirement
- ✅ Zero unexplained anomalies
- ✅ Monte Carlo justification (Tier 2+)

---

## 🎓 Cryptara AI Strategist

### Activation Stages

**Stage < 8**: INACTIVE (locked)
**Stage 8**: STAGE_8_ANALYSIS (dry run assistance)
**Stage 9+ (after 10 stable cycles)**: SURVEILLANCE (continuous analysis)

### Key Features

- ✅ Analysis ONLY (no execution authority)
- ✅ No background loops or timers
- ✅ Non-binding outputs (advisory)
- ✅ Stage-gated activation
- ✅ Verified isolation

### Check Status

```bash
curl http://localhost:5000/api/crypto/governance/cryptara/status
```

---

## ⚡ Common Workflows

### Workflow 1: Start Paper Trading

```bash
# 1. Initialize system
npx tsx server/services/cryptocrawl/init-system.ts

# 2. Set paper mode
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "paper"}'

# 3. Open gate
curl -X POST http://localhost:5000/api/crypto/governance/gate/open \
  -H "Content-Type: application/json" \
  -d '{"reason": "Starting paper trading"}'
```

### Workflow 2: Execute Dry Run (Stage 8)

```bash
# 1. Ensure Stages 1-7 are PASS
curl http://localhost:5000/api/crypto/governance/stages

# 2. Execute Stage 8
curl -X POST http://localhost:5000/api/crypto/governance/stages/8/execute

# 3. Review results
curl http://localhost:5000/api/crypto/governance/stages/8
```

### Workflow 3: Activate Live Trading (Tier 1)

```bash
# 1. Ensure Stage 8 is PASS
curl http://localhost:5000/api/crypto/governance/stages/8

# 2. Activate Tier 1
curl -X POST http://localhost:5000/api/crypto/governance/ramp/activate/1 \
  -H "Content-Type: application/json" \
  -d '{"monteCarloJustification": "Initial tier"}'

# 3. Set live mode
curl -X POST http://localhost:5000/api/crypto/governance/gate/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "live"}'

# 4. Open gate
curl -X POST http://localhost:5000/api/crypto/governance/gate/open \
  -H "Content-Type: application/json" \
  -d '{"reason": "Beginning live trading with $200/day cap"}'
```

### Workflow 4: Emergency Stop

```bash
# 1. Close execution gate
curl -X POST http://localhost:5000/api/crypto/governance/gate/close \
  -H "Content-Type: application/json" \
  -d '{"reason": "Emergency stop"}'

# 2. Pause system
curl -X POST http://localhost:5000/api/crypto/governance/composer/pause \
  -H "Content-Type: application/json" \
  -d '{"reason": "Emergency - investigating anomaly"}'
```

---

## 🔍 Troubleshooting

### System won't execute

```bash
# Check composer state
curl http://localhost:5000/api/crypto/governance/composer/status

# Check for locks (look for activeLocks)
# Check if system is paused (isSystemPaused)
```

### Cannot advance stage

```bash
# Check current stage status
curl http://localhost:5000/api/crypto/governance/stages

# Look for stages with status !== 'pass'
```

### Tier won't activate

```bash
# Check ramp status
curl http://localhost:5000/api/crypto/governance/ramp/status

# Verify:
# - Previous tier is 'passed'
# - No anomalies detected
# - Monte Carlo justification provided (Tier 2+)
```

---

## 📱 Key Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/crypto/governance/overview` | GET | Complete system status |
| `/api/crypto/governance/stages` | GET | All stages status |
| `/api/crypto/governance/stages/:id/start` | POST | Start a stage |
| `/api/crypto/governance/stages/6/execute` | POST | Execute Stage 6 |
| `/api/crypto/governance/stages/7/execute` | POST | Execute Stage 7 |
| `/api/crypto/governance/stages/8/execute` | POST | Execute Stage 8 |
| `/api/crypto/governance/ramp/status` | GET | Profit ramp status |
| `/api/crypto/governance/ramp/activate/:tier` | POST | Activate tier |
| `/api/crypto/governance/gate/status` | GET | Execution gate status |
| `/api/crypto/governance/gate/mode` | POST | Set execution mode |
| `/api/crypto/governance/gate/open` | POST | Open gate |
| `/api/crypto/governance/gate/close` | POST | Close gate |
| `/api/crypto/governance/composer/pause` | POST | Pause system |
| `/api/crypto/governance/composer/resume` | POST | Resume system |
| `/api/crypto/governance/cryptara/status` | GET | Cryptara AI status |

---

## 📚 Further Reading

- **Complete Documentation**: `/workspace/server/services/cryptocrawl/README-GOVERNANCE.md`
- **Implementation Summary**: `/workspace/CRYPTOCRAWLER_GOVERNANCE_IMPLEMENTATION.md`
- **Code Location**: `/workspace/server/services/cryptocrawl/governance/`

---

**Version**: 6.0.0  
**Status**: ✅ Production Ready  
**Last Updated**: December 15, 2025

---

*"The name of God is profitability"* - Now with complete governance and control.
