# 6-Stage Controlled Deployment System - Deployment Guide

## 🎯 Mission: $200/day → $35,000/day in 2 Months

This guide provides complete deployment and operational procedures for the Cryptocrawler 6-Stage Governance System.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Stage-by-Stage Deployment](#stage-by-stage-deployment)
5. [Operational Procedures](#operational-procedures)
6. [Monitoring & Alerts](#monitoring--alerts)
7. [Emergency Procedures](#emergency-procedures)
8. [Troubleshooting](#troubleshooting)

---

## System Overview

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                   GOVERNANCE SYSTEM                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │    Stage     │  │     Risk     │  │ Kill-Switch  │     │
│  │  Management  │  │   Governor   │  │   Manager    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Composer   │  │    Profit    │  │  Monitoring  │     │
│  │  Interface   │  │    Ladder    │  │  Dashboard   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   CRYPTARA + TRADING ENGINE                  │
└─────────────────────────────────────────────────────────────┘
```

### The 6 Stages

| Stage | Name | Execution | Daily Profit | Capital Required |
|-------|------|-----------|--------------|------------------|
| **1** | Constrained Pilot | ❌ Advisory Only | $0 | $1,000 (testing) |
| **2** | Proof-of-Signal | ✅ Limited | $200-500 | $5,000-10,000 |
| **3** | Measured Dry-Run | ✅ Expanding | $500-1,500 | $20,000-40,000 |
| **4** | Limited Autonomy | ✅ Conditional | $1,500-5,000 | $50,000-100,000 |
| **5** | Supervised Scaling | ✅ Supervised | $5,000-15,000 | $150,000-300,000 |
| **6** | Conditional Autonomy | ✅ Full* | $15,000-35,000 | $400,000-800,000 |

*Full autonomy within bounds, evolution lock remains ON

---

## Prerequisites

### System Requirements

- Node.js 18+
- PostgreSQL 14+ (for Eden knowledge repository)
- Redis 7+ (for caching)
- Supabase account (or self-hosted Supabase)
- 4+ GB RAM
- 50+ GB storage

### Environment Variables

Create `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/cryptocrawler
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Wallet Security
WALLET_ENCRYPTION_PASSWORD=your-secure-password-min-32-chars
WALLET_ENCRYPTION_SALT=your-secure-salt-min-16-chars

# RPC Endpoints
ALCHEMY_API_KEY=your-alchemy-key
INFURA_API_KEY=your-infura-key

# Governance
GOVERNANCE_MODE=PRODUCTION
EVOLUTION_LOCK=ON  # MUST BE ON
COMPOSER_AUTH_TOKEN=your-secure-composer-token

# Emergency
EMERGENCY_KEY_ESCROW=your-emergency-key-address
EMERGENCY_CONTACT_EMAIL=your-email@domain.com

# Monitoring
MONITORING_ENABLED=true
ALERT_WEBHOOK_URL=https://your-alert-webhook
```

### Initial Capital Requirements

**Minimum to Start:**
- Stage 1 (Testing): $1,000
- Stage 2 (Live): $5,000

**Recommended Path:**
- Start with $10,000 in Stage 2
- Add capital as you advance stages
- Target $800,000 by Stage 6 for full $35K/day capability

---

## Installation

### 1. Clone and Install

```bash
cd /workspace
npm install

# Install additional dependencies if needed
npm install @supabase/supabase-js
```

### 2. Database Setup

```bash
# Run Eden knowledge repository migration
psql $DATABASE_URL < db/migrations/eden_swarm_migration.sql

# Verify tables created
psql $DATABASE_URL -c "\dt eden_*"
```

### 3. Initialize Governance System

```typescript
import { initializeGovernance } from './server/services/cryptocrawl/governance';

await initializeGovernance();
```

### 4. Run Tests

```bash
# Run governance test suite
npx tsx server/services/cryptocrawl/governance/tests/governance-test-suite.ts

# Expected output: All tests passing ✅
```

---

## Stage-by-Stage Deployment

### 🟢 STAGE 1: Constrained Pilot (Days 1-7)

**Objective:** Validate advisory capabilities, no execution

**Setup:**

```typescript
import { composer, profitLadder } from './server/services/cryptocrawl/governance';

// Set initial capital (for testing only)
profitLadder.setCapital(1000);

// System starts paused at Stage 1
// Advisory mode only - no execution
```

**Actions:**

1. **Run Monte Carlo Simulations**
   ```typescript
   import { cryptaraGovernance } from './server/services/cryptocrawl/governance/cryptara-integration';
   
   await cryptaraGovernance.initialize();
   const result = await cryptaraGovernance.runMonteCarloSimulation();
   
   console.log('Simulation Results:', {
     expectedProfit: result.expectedProfit,
     sharpeRatio: result.sharpeRatio,
     winRate: result.winRate,
   });
   ```

2. **Analyze Arbitrage Paths**
   - Review signal reasoning
   - Validate fee/slippage calculations
   - Test latency assumptions

3. **Build Proof Metrics**
   - Need 100+ simulated trades
   - 70%+ success rate
   - Sharpe > 1.5

**Success Criteria:**
- ✅ 3+ days of stable simulations
- ✅ Monte Carlo pass rate > 80%
- ✅ No critical errors or anomalies
- ✅ Strategy confidence > 0.7

**Advance to Stage 2:**

```typescript
// After meeting criteria
const result = await composer.advanceStage(
  'human-operator-id',
  Stage.STAGE_2_PROOF_OF_SIGNAL
);

console.log(result.message);
// "Advanced to Proof-of-Signal Activation. System paused - requires UNPAUSE."
```

---

### 🟡 STAGE 2: Proof-of-Signal (Days 8-21)

**Objective:** First live execution with $200-500/day target

**Setup:**

```typescript
// Add live capital
profitLadder.setCapital(10000); // $10K recommended

// System is paused after stage advancement
// Must explicitly UNPAUSE
```

**UNPAUSE Process:**

```typescript
const result = await composer.unpause(
  'human-operator-id',
  {
    allowedChains: ['polygon', 'arbitrum'],
    maxPairs: 10,
    maxVenues: 3,
    maxDailyProfit: 500,
  },
  86400000 // 24 hours
);

console.log(result.message);
// "System UNPAUSED by human-operator-id for scope: Stage 2, 10 pairs, 3 venues..."
```

**Operations:**

1. **Monitor First Trades**
   ```typescript
   import { monitoringDashboard } from './server/services/cryptocrawl/governance/monitoring-dashboard';
   
   monitoringDashboard.start(5000); // Update every 5s
   
   monitoringDashboard.on('update', (data) => {
     console.log('Daily Profit:', data.profitMetrics.dailyProfit);
     console.log('Success Rate:', data.performance.successRate);
     console.log('Alerts:', data.alerts.length);
   });
   ```

2. **Review Approvals**
   - Every trade requires human approval in Stage 2
   - Risk governor gates all proposals
   - Monte Carlo consensus required

3. **Daily Reconciliation**
   ```typescript
   // Run at midnight UTC
   await cryptaraGovernance.dailyReconciliation();
   ```

**Success Criteria:**
- ✅ 7+ days at $200-500/day
- ✅ Success rate > 65%
- ✅ Sharpe ratio > 1.2
- ✅ Max drawdown < 5%
- ✅ Zero critical anomalies

**Daily Checklist:**
- [ ] Review overnight performance
- [ ] Check circuit breakers (should be green)
- [ ] Verify daily profit within range
- [ ] Monitor anomaly count
- [ ] Run daily reconciliation
- [ ] UNPAUSE for next 24 hours

---

### 🟠 STAGE 3: Measured Dry-Run (Days 22-42)

**Objective:** Expand scope to $500-1,500/day

**Setup:**

```typescript
profitLadder.setCapital(40000); // $40K recommended

const result = await composer.advanceStage(
  'human-operator-id',
  Stage.STAGE_3_MEASURED_DRYRUN
);
```

**Scope Expansion:**

```typescript
await composer.unpause(
  'human-operator-id',
  {
    allowedChains: ['polygon', 'arbitrum', 'optimism'],
    maxPairs: 20,
    maxVenues: 5,
    maxDailyProfit: 1500,
  }
);
```

**Key Changes:**
- More pairs and venues allowed
- 3 chains operational
- Still requires forced cool-downs
- No scope drift permitted

**Success Criteria:**
- ✅ 10+ days at $1,000+/day
- ✅ Success rate > 65%
- ✅ Sharpe ratio > 1.3
- ✅ Max drawdown < 10%
- ✅ Capital efficiency improving

---

### 🔵 STAGE 4: Limited Autonomy (Days 43-70)

**Objective:** Narrow conditional autonomy, $1,500-5,000/day

**Setup:**

```typescript
profitLadder.setCapital(100000); // $100K recommended

await composer.advanceStage(
  'human-operator-id',
  Stage.STAGE_4_LIMITED_AUTONOMY
);
```

**Key Changes:**
- ✅ **No longer requires human approval** for trades within corridors
- ✅ Still requires explicit UNPAUSE
- ✅ Autonomy only inside defined bounds
- ✅ Continuous Monte Carlo validation

**Monitoring:**

```typescript
// Set up automatic alerts
monitoringDashboard.on('alert', (alert) => {
  if (alert.severity === 'critical') {
    // Send to Slack/PagerDuty/Email
    console.error('CRITICAL ALERT:', alert.message);
  }
});
```

**Success Criteria:**
- ✅ 14+ days at $3,000+/day
- ✅ Success rate > 68%
- ✅ Sharpe ratio > 1.4
- ✅ Autonomous operations stable

---

### 🟣 STAGE 5: Supervised Scaling (Days 71-120)

**Objective:** Scale to $5,000-15,000/day

**Setup:**

```typescript
profitLadder.setCapital(300000); // $300K recommended

await composer.advanceStage(
  'human-operator-id',
  Stage.STAGE_5_SUPERVISED_SCALING
);
```

**Operations:**
- 5 chains active
- 100 pairs allowed
- Intensified risk monitoring
- Auto-pause after expansion checkpoints

**Capital Scaling:**
- Week 1: $5K/day
- Week 2: $8K/day
- Week 3: $12K/day
- Week 4+: $15K/day

**Success Criteria:**
- ✅ 21+ days at $10,000+/day
- ✅ Success rate > 70%
- ✅ Sharpe ratio > 1.5
- ✅ Drawdown < 15%

---

### 🔴 STAGE 6: Conditional Autonomy (Days 121-150)

**Objective:** Achieve $15,000-35,000/day target

**Setup:**

```typescript
profitLadder.setCapital(800000); // $800K for full $35K capability

await composer.advanceStage(
  'human-operator-id',
  Stage.STAGE_6_CONDITIONAL_AUTONOMY
);
```

**Key Changes:**
- ✅ Full autonomy within bounds
- ✅ **No longer requires UNPAUSE** (can run continuously)
- ✅ Evolution Lock **REMAINS ON** (no self-modification)
- ✅ Automatic re-lock on anomaly/drift

**Monitoring is Critical:**
- 24/7 monitoring dashboard
- Automated alert systems
- Weekly performance reviews
- Monthly risk audits

**Success Criteria:**
- ✅ 30+ days at $25,000+/day
- ✅ Success rate > 72%
- ✅ Sharpe ratio > 1.6
- ✅ System stability proven

---

## Operational Procedures

### Daily Operations

#### Morning Checklist (8:00 AM UTC)

```bash
# 1. Check system status
curl http://localhost:3000/api/governance/status

# 2. Review overnight performance
curl http://localhost:3000/api/governance/dashboard

# 3. Check for alerts
curl http://localhost:3000/api/governance/alerts

# 4. Run daily reconciliation
curl -X POST http://localhost:3000/api/governance/daily-reconciliation
```

#### Midday Check (12:00 PM UTC)

- Verify profit tracking on target
- Check for circuit breaker warnings
- Review anomaly count
- Ensure UNPAUSE is active (Stages 1-5)

#### Evening Review (8:00 PM UTC)

- Review daily P&L
- Check drawdown levels
- Verify capital utilization
- Plan next day scope if needed

### Weekly Operations

#### Monday: Planning
- Review previous week performance
- Adjust scope if needed
- Plan capital additions
- Check roadmap progress

#### Wednesday: Risk Review
- Analyze drawdown patterns
- Review circuit breaker history
- Audit risk governor decisions
- Test kill-switch (dry-run)

#### Friday: Performance Analysis
- Calculate weekly metrics
- Compare to tier targets
- Review advancement criteria
- Generate performance report

### Monthly Operations

- Tier advancement assessment
- Capital requirements review
- System audit and security scan
- Strategy optimization review
- Backup and disaster recovery test

---

## Monitoring & Alerts

### Dashboard Access

```typescript
import { monitoringDashboard } from './server/services/cryptocrawl/governance/monitoring-dashboard';

// Start dashboard
monitoringDashboard.start(5000);

// Get current data
const data = monitoringDashboard.getDashboardData();
console.log(data);
```

### Alert Levels

| Severity | Action | Example |
|----------|--------|---------|
| **INFO** | Log only | Tier advanced, trade executed |
| **WARNING** | Monitor | Approaching drawdown limit |
| **ERROR** | Review ASAP | Circuit breaker triggered |
| **CRITICAL** | Immediate action | Kill-switch activated, anomaly |

### Key Metrics to Monitor

1. **Daily Profit**
   - Target vs Actual
   - Running total
   - Tier progress

2. **Risk Indicators**
   - Current drawdown %
   - Circuit breaker status
   - Anomaly count
   - Approval rate

3. **Performance Metrics**
   - Success rate
   - Sharpe ratio
   - Win/loss ratio
   - Avg profit per trade

4. **System Health**
   - Uptime
   - Pause status
   - Stage configuration
   - Kill-switch armed

---

## Emergency Procedures

### 🚨 Emergency: System Malfunction

```typescript
// SOFT HALT (pause, can resume)
await composer.halt('human-operator-id', 'System malfunction detected');

// Or use kill-switch
await killSwitch.activate(
  KillSwitchType.SOFT_HALT,
  'system-admin',
  'Emergency halt',
  process.env.COMPOSER_AUTH_TOKEN
);
```

### 🔥 Critical: Major Loss Event

```typescript
// HARD HALT (full stop, requires restart)
await killSwitch.activate(
  KillSwitchType.HARD_HALT,
  'system-admin',
  'Major loss event - immediate halt',
  process.env.COMPOSER_AUTH_TOKEN
);
```

### ☢️ Catastrophic: Complete Shutdown

```typescript
// EMERGENCY SHUTDOWN (immediate, preserve state)
await killSwitch.activate(
  KillSwitchType.EMERGENCY_SHUTDOWN,
  'system-admin',
  'Catastrophic failure',
  process.env.COMPOSER_AUTH_TOKEN
);

// This will:
// 1. Pause all operations immediately
// 2. Save all state to database
// 3. Perform Eden return pulse
// 4. Close positions (if configured)
// 5. Stop swarm operations
```

### Recovery Procedures

```typescript
// After resolving issue, attempt recovery
const result = await killSwitch.attemptRecovery(
  'system-admin',
  process.env.COMPOSER_AUTH_TOKEN
);

if (result.success) {
  // System is now paused but stable
  // Perform checks before UNPAUSE
  const status = composer.getSystemStatus();
  console.log('System Status:', status);
  
  // When ready, UNPAUSE
  await composer.unpause(
    'system-admin',
    { /* scope */ }
  );
}
```

---

## Troubleshooting

### Issue: System Won't UNPAUSE

**Symptoms:** `requestUnpause()` returns `success: false`

**Solutions:**
1. Check authority: Must provide valid composer ID
2. Check scope: Must define explicit scope
3. Check stage config: Current stage must allow execution
4. Check kill-switch: Must not be active

```typescript
// Debug
const state = stageManager.getState();
const ksState = killSwitch.getState();

console.log('Paused:', state.isPaused);
console.log('Kill-Switch Active:', ksState.isActive);
console.log('Pause Reason:', state.pauseReason);
```

### Issue: Trades Not Executing

**Symptoms:** Trade proposals rejected by risk governor

**Solutions:**
1. Check if system is paused
2. Verify position size within limits
3. Check daily profit limit not exceeded
4. Review circuit breaker status
5. Check Monte Carlo consensus

```typescript
// Debug trade rejection
const proposal = { /* ... */ };
const assessment = await riskGovernor.assessTradeProposal(proposal);

console.log('Approved:', assessment.approved);
console.log('Reason:', assessment.reason);
console.log('Checks:', assessment.checksPass);
```

### Issue: Can't Advance Stage

**Symptoms:** `advanceStage()` returns criteria not met

**Solutions:**
1. Check proof metrics meet requirements
2. Verify sufficient time in stage
3. Ensure success rate above threshold
4. Check capital requirements

```typescript
// Check advancement readiness
const metrics = stageManager.getState().proofMetrics;
const progress = profitLadder.getProgressSummary();

console.log('Meets Criteria:', metrics.meetsAdvancementCriteria);
console.log('Blockers:', progress.blockers);
```

### Issue: Unexpected Pause

**Symptoms:** System pauses automatically

**Possible Causes:**
- Circuit breaker tripped
- Daily profit limit reached
- Anomaly detected (critical severity)
- Automatic pause after cycle (Stages 1-5)
- Kill-switch triggered

```typescript
// Check pause reason
const state = stageManager.getState();
console.log('Pause Reason:', state.pauseReason);
console.log('Last Anomaly:', state.lastAnomalyReason);

// Check circuit breakers
const breakers = riskGovernor.getTrippedCircuitBreakers();
console.log('Tripped Breakers:', breakers);
```

---

## Performance Optimization Tips

### 1. Capital Allocation

- Start conservative, scale gradually
- Keep 20% reserve for drawdowns
- Add capital as you prove each tier
- Don't over-leverage early stages

### 2. Risk Management

- Use half-Kelly sizing (safer than full Kelly)
- Set tight stop-losses early
- Gradually increase position sizes
- Monitor correlations across chains

### 3. Strategy Selection

- Stage 2-3: Focus on high Sharpe strategies
- Stage 4-5: Add moderate risk strategies
- Stage 6: Full strategy portfolio

### 4. Monitoring

- Stage 2-3: Check every 2-4 hours
- Stage 4-5: Check every 6-8 hours
- Stage 6: Daily reviews sufficient (with alerts)

---

## Success Metrics

### By Stage Milestones

| Stage | Days | Daily Profit | Total Profit | Success Rate | Sharpe |
|-------|------|--------------|--------------|--------------|--------|
| 1 | 7 | $0 | $0 | N/A | N/A |
| 2 | 14 | $300 | $4,200 | 65% | 1.2 |
| 3 | 21 | $1,000 | $25,200 | 65% | 1.3 |
| 4 | 28 | $3,000 | $109,200 | 68% | 1.4 |
| 5 | 30 | $10,000 | $409,200 | 70% | 1.5 |
| 6 | 30 | $25,000 | $1,159,200 | 72% | 1.6 |

**Total Timeline: ~130 days (4.3 months)**

**Cumulative Profit at $35K/day:** ~$1.2M

---

## Final Checklist Before Production

- [ ] All tests passing
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] Supabase credentials valid
- [ ] Kill-switch tested (dry-run)
- [ ] Monitoring dashboard running
- [ ] Alert webhooks configured
- [ ] Emergency contacts defined
- [ ] Initial capital deposited
- [ ] Backup procedures tested
- [ ] Security audit completed
- [ ] Team trained on procedures

---

## Support & Resources

### Documentation
- [Stage Management](./stage-management.ts)
- [Risk Governor](./risk-governor.ts)
- [Profit Ladder](./profit-ladder.ts)
- [Composer Interface](./composer-interface.ts)

### Testing
- [Test Suite](./tests/governance-test-suite.ts)

### Monitoring
- Dashboard: `http://localhost:3000/governance/dashboard`
- API Status: `http://localhost:3000/api/governance/status`

---

## Legal Disclaimer

This system is provided for cryptocurrency arbitrage and trading operations. Users are responsible for:

- Compliance with all applicable laws and regulations
- Risk management and capital preservation
- System monitoring and oversight
- Security of credentials and keys

The system includes safety controls but does not guarantee profits. Trading carries risk of loss.

---

**System Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Last Updated:** December 2024  
**Deployment Target:** $200/day → $35,000/day in 2 months
