# Operational Runbook - Quick Reference

## Phase 8 - Integrate Zero Capital / Europa / Beam

The capital decision begins with the authoritative wallet assessment. Zero Capital/Europa is the redundancy/escalation path when existing wallet capital is insufficient, inefficient, or inappropriate under the existing architecture. Beam must consume the relevant wallet/Europa result and perform its intended computational role before execution. Railway provides the production computational runtime for these systems; it is not itself a source of blockchain capital or gas. Preserve this hierarchy throughout the execution architecture.

## 🚀 Quick Start Commands

### Initialize System
```typescript
import { initializeGovernance } from './governance';
await initializeGovernance();
```

### Start Monitoring
```typescript
import { monitoringDashboard } from './governance/monitoring-dashboard';
monitoringDashboard.start(5000);
```

### Check Status
```typescript
import { composer } from './governance/composer-interface';
const status = composer.getSystemStatus();
console.log(status);
```

---

## 🔐 UNPAUSE Command (Primary Control)

```typescript
import { composer } from './governance/composer-interface';

await composer.unpause(
  'your-operator-id',           // Your authority ID
  {
    allowedChains: ['polygon', 'arbitrum'],
    maxPairs: 10,
    maxVenues: 3,
    maxDailyProfit: 500,
  },
  86400000  // Duration: 24 hours in milliseconds
);
```

---

## 📊 Daily Operations Checklist

### Morning (8 AM UTC)
```bash
✓ Check system status
✓ Review overnight P&L
✓ Check alerts
✓ Run daily reconciliation
✓ UNPAUSE for today (Stages 1-5)
```

### Midday (12 PM UTC)
```bash
✓ Verify on-target profit
✓ Check circuit breakers
✓ Review anomaly count
```

### Evening (8 PM UTC)
```bash
✓ Review daily performance
✓ Check drawdown levels
✓ Verify capital utilization
```

---

## 🚨 Emergency Commands

### Pause System
```typescript
await composer.pause('operator-id', 'Emergency pause reason');
```

### Soft Halt (Recoverable)
```typescript
await killSwitch.activate(
  KillSwitchType.SOFT_HALT,
  'operator-id',
  'Reason for halt',
  process.env.COMPOSER_AUTH_TOKEN
);
```

### Hard Halt (Requires Restart)
```typescript
await killSwitch.activate(
  KillSwitchType.HARD_HALT,
  'operator-id',
  'Critical issue',
  process.env.COMPOSER_AUTH_TOKEN
);
```

### Emergency Shutdown
```typescript
await killSwitch.activate(
  KillSwitchType.EMERGENCY_SHUTDOWN,
  'operator-id',
  'Catastrophic failure',
  process.env.COMPOSER_AUTH_TOKEN
);
```

---

## 📈 Stage Advancement

```typescript
import { composer, Stage } from './governance';

// After meeting all criteria
await composer.advanceStage(
  'operator-id',
  Stage.STAGE_2_PROOF_OF_SIGNAL
);
```

### Advancement Criteria by Stage

**Stage 1 → Stage 2:**
- 100+ simulated trades
- 70%+ success rate
- Sharpe > 1.5
- 3+ days stable

**Stage 2 → Stage 3:**
- 7+ days at $200-500/day
- 65%+ success rate
- Sharpe > 1.2
- Max drawdown < 5%

**Stage 3 → Stage 4:**
- 10+ days at $1,000+/day
- 65%+ success rate  
- Sharpe > 1.3
- Max drawdown < 10%

**Stage 4 → Stage 5:**
- 14+ days at $3,000+/day
- 68%+ success rate
- Sharpe > 1.4
- Autonomous stability

**Stage 5 → Stage 6:**
- 21+ days at $10,000+/day
- 70%+ success rate
- Sharpe > 1.5
- Proven scalability

---

## 💰 Profit Tracking

### Record Capital
```typescript
import { profitLadder } from './governance/profit-ladder';
profitLadder.setCapital(100000); // $100K
```

### Check Progress
```typescript
const progress = profitLadder.getProgressSummary();
console.log('Current Tier:', progress.currentTier);
console.log('Avg Daily:', progress.avgDailyProfit);
console.log('Ready for Next:', progress.readyForNextTier);
console.log('Blockers:', progress.blockers);
```

### View Roadmap
```typescript
const roadmap = profitLadder.getRoadmapTo35K();
console.log('Days to $35K:', roadmap.estimatedDaysToGoal);
console.log('Milestones:', roadmap.tierMilestones);
```

---

## 🔍 Monitoring & Debugging

### Get Dashboard Data
```typescript
import { monitoringDashboard } from './governance/monitoring-dashboard';
const data = monitoringDashboard.getDashboardData();

console.log('Daily Profit:', data.profitMetrics.dailyProfit);
console.log('Success Rate:', data.performance.successRate);
console.log('Risk Level:', data.risk.riskLevel);
console.log('Alerts:', data.alerts);
```

### Check Circuit Breakers
```typescript
import { riskGovernor } from './governance/risk-governor';
const breakers = riskGovernor.getAllCircuitBreakers();
const tripped = riskGovernor.getTrippedCircuitBreakers();

console.log('All Breakers:', breakers);
console.log('Tripped:', tripped);
```

### View Command History
```typescript
const history = composer.getCommandHistory(20); // Last 20
console.log(history);
```

---

## 🧪 Testing

### Run Full Test Suite
```bash
npx tsx server/services/cryptocrawl/governance/tests/governance-test-suite.ts
```

### Test Monte Carlo
```typescript
import { cryptaraGovernance } from './governance/cryptara-integration';
await cryptaraGovernance.initialize();
const result = await cryptaraGovernance.runMonteCarloSimulation();
console.log(result);
```

---

## 🛠️ Troubleshooting

### Can't UNPAUSE?
```typescript
// Check state
const state = stageManager.getState();
console.log('Paused:', state.isPaused);
console.log('Reason:', state.pauseReason);

// Check kill-switch
const ksState = killSwitch.getState();
console.log('KS Active:', ksState.isActive);
```

### Trades Not Executing?
```typescript
// Test trade proposal
const proposal = {
  id: 'test-1',
  strategy: 'test',
  chain: 'polygon',
  pair: 'ETH/USDC',
  venue: 'uniswap',
  positionSizeUSD: 50,
  estimatedProfitUSD: 5,
  estimatedRiskPercent: 0.02,
  timestamp: Date.now(),
};

const assessment = await riskGovernor.assessTradeProposal(proposal);
console.log('Approved:', assessment.approved);
console.log('Reason:', assessment.reason);
console.log('Checks:', assessment.checksPass);
```

### System Paused Unexpectedly?
```typescript
// Check anomalies
const state = stageManager.getState();
console.log('Anomaly Count:', state.anomalyCount);
console.log('Last Anomaly:', state.lastAnomalyReason);

// Check breakers
const tripped = riskGovernor.getTrippedCircuitBreakers();
if (tripped.length > 0) {
  console.log('Tripped Breakers:', tripped);
}
```

---

## 📞 Emergency Contacts

**System Issues:**
- Check logs: `tail -f logs/governance.log`
- Check monitoring dashboard
- Review recent alerts

**Critical Failures:**
1. Activate kill-switch
2. Preserve state
3. Contact team
4. Review recovery procedures

---

## 🔑 Key Metrics Reference

| Metric | Stage 2 | Stage 3 | Stage 4 | Stage 5 | Stage 6 |
|--------|---------|---------|---------|---------|---------|
| Daily Profit | $200-500 | $500-1500 | $1.5K-5K | $5K-15K | $15K-35K |
| Capital | $10K | $40K | $100K | $300K | $800K |
| Success Rate | 65% | 65% | 68% | 70% | 72% |
| Sharpe | 1.2 | 1.3 | 1.4 | 1.5 | 1.6 |
| Max DD | 5% | 10% | 12% | 15% | 15% |

---

## 📚 Additional Resources

- [Full Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Test Suite](./tests/governance-test-suite.ts)
- [API Documentation](./index.ts)

---

**Quick Reference Version:** 1.0.0  
**Last Updated:** December 2024
