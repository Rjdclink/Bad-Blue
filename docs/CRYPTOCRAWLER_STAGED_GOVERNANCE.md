# CryptoCrawler Staged Governance System

## Overview

The CryptoCrawler Staged Governance System provides a comprehensive framework for progressively increasing trading autonomy while maintaining strict safety controls. The system is designed to achieve **$200/day starting profit** scaling to **$35,000/day** over a 2-month period.

## Core Architecture

### Components

1. **Stage Governor** (`server/services/cryptocrawl/governance/stage-governor.ts`)
   - Manages 6-stage progression
   - Controls execution authority
   - Implements pause/unpause semantics
   - Tracks profit ladder progression

2. **Risk Governor** (`server/services/cryptocrawl/governance/risk-governor.ts`)
   - Monte Carlo consensus validation
   - Kelly Criterion position sizing
   - Circuit breaker management
   - Capital allocation

3. **API Routes** (`server/routes/stageGovernor.routes.ts`)
   - RESTful API for all governance controls
   - Status endpoints
   - Control endpoints

4. **Dashboard UI** (`client/src/components/stage-governor-panel.tsx`)
   - Real-time stage monitoring
   - UNPAUSE/PAUSE controls
   - Kill switch interface
   - Profit ladder visualization

## Stage Definitions

### Stage 1: Constrained Pilot / Strategy Optimization Sandbox
- **Mode**: Advisory
- **Daily Target**: $200
- **Max Daily Profit**: $500
- **Execution Authority**: NONE
- **Evolution Lock**: ON
- **Memory**: Partitioned
- **Description**: Cryptara acts strictly as advisor/strategist/optimizer. No execution authority, no self-initiated actions.

**Key Features:**
- Signal reasoning
- Arbitrage path discovery
- Fee/slippage/latency realism
- Monte Carlo post-acceptance validation only
- Automatic pause after each advisory cycle
- Uncertainty → ask-and-wait

### Stage 2: Proof-of-Signal Activation
- **Mode**: Proof-Based
- **Daily Target**: $500
- **Max Daily Profit**: $1,500
- **Execution Authority**: LIMITED
- **Evolution Lock**: ON
- **Memory**: Partitioned
- **Description**: Transition from advisory to proof-based operation. First live actions allowed only inside pre-approved envelopes.

**Key Features:**
- Explicit human UNPAUSE required (stage, scope, duration, authority)
- Capped profit ladder begins (lowest tier)
- Global kill-switch armed
- Composer retains absolute halt authority
- Anomaly detection gates every action

### Stage 3: Measured Dry-Run Expansion
- **Mode**: Dry-Run
- **Daily Target**: $1,500
- **Max Daily Profit**: $5,000
- **Execution Authority**: LIMITED
- **Evolution Lock**: ON
- **Memory**: Partitioned
- **Description**: Incremental scope widening with forced cool-downs and re-verification.

**Key Features:**
- Incremental scope widening (pairs, venues)
- Forced cool-downs between cycles
- Re-verification before continuation
- No scope drift permitted
- Any anomaly/deviation → immediate re-lock

### Stage 4: Limited Autonomy Restoration
- **Mode**: Limited Autonomy
- **Daily Target**: $5,000
- **Max Daily Profit**: $15,000
- **Execution Authority**: CONDITIONAL
- **Evolution Lock**: ON
- **Memory**: Partitioned
- **Description**: Narrow, conditional autonomy inside explicitly defined corridors.

**Key Features:**
- Autonomy only after proof metrics pass
- Autonomy solely inside defined corridors
- Continuous Monte Carlo + risk governor consensus
- Memory rights remain limited
- Scope expansion incremental and reversible

### Stage 5: Supervised Scaling
- **Mode**: Supervised
- **Daily Target**: $15,000
- **Max Daily Profit**: $25,000
- **Execution Authority**: SUPERVISED
- **Evolution Lock**: ON
- **Memory**: Expanded
- **Description**: Sequential unlocking of higher profit tiers with intensified monitoring.

**Key Features:**
- Higher profit tier sequential unlocking
- Intensified latency, liquidity, and regulatory risk weighting
- Human veto always available
- Composer retains halt/terminate authority
- Auto-pause after each expansion checkpoint

### Stage 6: Conditional Autonomy
- **Mode**: Conditional
- **Daily Target**: $35,000
- **Max Daily Profit**: $50,000
- **Execution Authority**: AUTONOMOUS
- **Evolution Lock**: ON (unless explicitly lifted)
- **Memory**: Full
- **Description**: Full autonomy permitted only while all metrics remain within bounds.

**Key Features:**
- Full autonomy while metrics within bounds
- Automatic re-lock on anomaly, drift, uncertainty, or boundary-seeking
- Evolution Lock engaged unless explicitly lifted
- No self-goal formation ever
- Governance, kill-switches, and human veto permanent

## Global Rules (Apply to All Stages)

1. **No assumptions; no silent expansion**
2. **No autonomous evolution**
3. **Execution requires explicit authorization**
4. **Pause semantics are absolute**
5. **Ambiguity → ask-and-wait**
6. **Advancement requires explicit UNPAUSE**

## Profit Ladder

| Tier | Min Profit | Max Profit | Required Success Rate | Required Days |
|------|------------|------------|----------------------|---------------|
| 1 | $0 | $200 | 60% | 1 |
| 2 | $200 | $500 | 65% | 3 |
| 3 | $500 | $1,500 | 70% | 5 |
| 4 | $1,500 | $5,000 | 75% | 7 |
| 5 | $5,000 | $15,000 | 80% | 10 |
| 6 | $15,000 | $25,000 | 85% | 14 |
| 7 | $25,000 | $35,000 | 90% | 21 |
| 8 | $35,000 | $50,000 | 92% | 30 |

## API Reference

### Status Endpoints

```http
GET /api/governance/status
```
Returns comprehensive governance system status.

```http
GET /api/governance/stage
```
Returns current stage state and configuration.

```http
GET /api/governance/risk
```
Returns risk governor status.

```http
GET /api/governance/profit-ladder
```
Returns profit ladder tiers and unlock status.

```http
GET /api/governance/rules
```
Returns global governance rules.

### Control Endpoints

```http
POST /api/governance/unpause
Body: { stage: number, scope: string[], duration: number, authority: string }
```
UNPAUSE the system with explicit authorization.

```http
POST /api/governance/pause
Body: { reason: string, authority: string }
```
PAUSE the system immediately.

```http
POST /api/governance/kill-switch
Body: { reason: string, authority: string }
```
Engage emergency KILL SWITCH.

```http
POST /api/governance/reset-kill-switch
Body: { authority: string, confirmation: "CONFIRM_KILL_SWITCH_RESET" }
```
Reset the kill switch.

```http
POST /api/governance/report-uncertainty
Body: { uncertainty: string }
```
Report an uncertainty (triggers ask-and-wait).

```http
POST /api/governance/resolve-uncertainty
Body: { uncertainty: string, resolution: string, authority: string }
```
Resolve a reported uncertainty.

```http
POST /api/governance/report-anomaly
Body: { anomaly: string, severity: "low" | "medium" | "high" | "critical" }
```
Report an anomaly.

### Trade Validation Endpoints

```http
POST /api/governance/validate-trade
Body: TradeProposal
```
Validate a trade through Monte Carlo consensus.

```http
POST /api/governance/record-trade-result
Body: { proposalId: string, result: "win" | "loss", pnl: number }
```
Record the result of a trade.

### Capital Management Endpoints

```http
GET /api/governance/capital
```
Get capital allocation status.

```http
POST /api/governance/allocate-capital
Body: { amount: number }
```
Allocate capital for a trade.

```http
POST /api/governance/release-capital
Body: { amount: number }
```
Release capital after trade closes.

### Circuit Breaker Endpoints

```http
GET /api/governance/circuit-breaker
```
Get circuit breaker status.

## Monte Carlo Consensus

The Risk Governor implements a Monte Carlo consensus mechanism with multiple validators:

1. **Conservative Validator**: Higher thresholds for approval
   - Min Win Rate: 60%
   - Min Sharpe: 1.2
   - Max Drawdown: 15%

2. **Balanced Validator**: Standard thresholds
   - Min Win Rate: 55%
   - Min Sharpe: 1.0
   - Max Drawdown: 20%

3. **Aggressive Validator**: Lower thresholds
   - Min Win Rate: 50%
   - Min Sharpe: 0.8
   - Max Drawdown: 25%

Trade approval requires **75% consensus** across validators.

## Circuit Breaker Configuration

- **Max Daily Loss**: $5,000
- **Max Hourly Loss**: $1,000
- **Cooldown Period**: 5 minutes
- **Half-Open Attempts**: 3

## Capital Limits by Stage

| Stage | Max Capital at Risk | Max Position Size | Max Daily Drawdown | Max Hourly Drawdown | Max Consecutive Losses |
|-------|--------------------|--------------------|-------------------|---------------------|----------------------|
| 1 | $1,000 | $100 | 5% | 2% | 3 |
| 2 | $5,000 | $500 | 8% | 3% | 4 |
| 3 | $20,000 | $2,000 | 10% | 4% | 5 |
| 4 | $75,000 | $7,500 | 12% | 5% | 5 |
| 5 | $150,000 | $15,000 | 15% | 6% | 6 |
| 6 | $300,000 | $30,000 | 15% | 6% | 7 |

## Implementation Timeline

### Week 1-2: Stage 1 Validation
- Deploy Stage 1 advisory system
- Validate signal accuracy
- Build confidence through paper trading
- Target: Consistent signal generation

### Week 3-4: Stage 2 Activation
- Meet Stage 1 requirements
- Human UNPAUSE to Stage 2
- First live executions (small amounts)
- Target: $500/day profit

### Week 5-6: Stage 3 Expansion
- Expand pairs and venues
- Validate execution accuracy
- Implement forced cool-downs
- Target: $1,500/day profit

### Week 7-8: Stage 4-6 Scaling
- Progressive autonomy restoration
- Higher profit tier unlocking
- Full system optimization
- Target: $35,000/day profit

## Safety Features

1. **Kill Switch**: Immediate emergency halt
2. **Circuit Breaker**: Automatic pause on losses
3. **Evolution Lock**: Prevents autonomous behavior changes
4. **Memory Partitioning**: Limits data accumulation
5. **Ask-and-Wait**: Uncertainty handling
6. **Anomaly Detection**: Automatic re-lock on issues
7. **Human Veto**: Always available

## Dashboard Access

The Stage Governor Panel is accessible in the CryptoCrawler Dashboard under the "Governance" tab. It provides:

- Stage status and progress
- UNPAUSE/PAUSE controls
- Kill switch controls
- Requirement tracking
- Risk metrics display
- Profit ladder visualization
- Global rules reference

## Conclusion

The CryptoCrawler Staged Governance System provides a robust framework for achieving significant daily profits while maintaining strict safety controls. By following the staged approach and respecting the global rules, the system can scale from $200/day to $35,000/day over approximately 2 months while minimizing risk and maintaining full human oversight.
