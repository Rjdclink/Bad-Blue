# QUICK START: SCALING CHECKLIST

**Use this checklist to begin controlled scaling immediately.**

---

## PRE-FLIGHT ✈️

### 1. Run Verification (5 min)
```bash
cd /workspace
npx tsx scripts/verify-production-readiness.ts
```

**Expected:** All checks pass, 0 blockers

---

## INTEGRATION (1-2 hours) 🔧

### 2. Integrate Daily Cap Ladder

**File:** `server/services/cryptocrawl/faucet/autonomous-faucet.ts`

**Add imports:**
```typescript
import { dailyCapLadder } from '../risk';
```

**Before trade execution:**
```typescript
const canTrade = dailyCapLadder.recordTrade(estimatedProfit, false);
if (!canTrade) {
  return { success: false, reason: 'daily_cap_reached' };
}
```

**After successful trade:**
```typescript
dailyCapLadder.recordTrade(actualProfit, true);
```

### 3. Integrate Global Halt Controller

**Add imports:**
```typescript
import { globalHaltController } from '../risk';
```

**Add halt listener:**
```typescript
globalHaltController.on('halt', (event) => {
  logger.error('[FAUCET] Halted:', event.reason);
  this.stopFaucet();
});
```

**In execution loop:**
```typescript
if (globalHaltController.isHalted()) {
  await sleep(5000);
  continue;
}
```

**Update conditions:**
```typescript
globalHaltController.updateConditionByType('drawdown', currentDrawdown);
```

---

## TESTING (30 min) 🧪

### 4. Test Cap Enforcement
```typescript
// Simulate hitting daily cap
for (let i = 0; i < 100; i++) {
  dailyCapLadder.recordTrade(3, true); // $3 per trade
}
// Should halt at $200
```

### 5. Test Manual Halt
```typescript
globalHaltController.triggerHalt('Test halt', 'critical');
// Verify faucet stops
globalHaltController.resume(true);
// Verify faucet resumes
```

---

## LAUNCH DAY 🚀

### 6. Start Tier 1
```bash
# Verify tier status
dailyCapLadder.getCurrentTierConfig()
# Should show: Tier 1, $200 max

# Enable faucet
# Monitor console for cap ladder messages
```

### 7. Monitor Daily
```bash
# Check cap status
dailyCapLadder.getCapStatus()

# Check halt status  
globalHaltController.getStatus()

# View performance
dailyCapLadder.getPerformanceHistory(7)
```

---

## DASHBOARD (Optional, 1 hour) 📊

### 8. Add UI Widgets

**Cap Ladder Status:**
```typescript
const capStatus = dailyCapLadder.getCapStatus();

<div>
  <h3>Tier {capStatus.currentTier}</h3>
  <p>${capStatus.currentDailyProfit} / ${capStatus.maxDailyProfit}</p>
  <Progress value={capStatus.percentOfCap} />
</div>
```

**Halt Controller Status:**
```typescript
const haltStatus = globalHaltController.getStatus();

<Badge variant={haltStatus.halted ? 'destructive' : 'success'}>
  {haltStatus.halted ? 'HALTED' : 'RUNNING'}
</Badge>
```

---

## DAILY CHECKLIST (5 min/day) 📅

### Morning Check
- [ ] View yesterday's performance: `dailyCapLadder.getPerformanceHistory(1)`
- [ ] Check if any halts occurred: `globalHaltController.getHaltHistory(1)`
- [ ] Verify tier advancement eligibility: `dailyCapLadder.checkAdvancement()`
- [ ] Check success rate and variance

### Evening Check
- [ ] Review daily profit vs cap
- [ ] Check for any anomalies
- [ ] Review halt controller conditions
- [ ] Prepare notes for advancement decision

---

## ADVANCEMENT DECISION (After 5 days) ⬆️

### Check Eligibility
```typescript
const advancementCheck = dailyCapLadder.checkAdvancement();
console.log(advancementCheck);

// If canAdvance: true
dailyCapLadder.advanceTier();
```

### Requirements
- ✅ 5 consecutive stable days
- ✅ Success rate above threshold
- ✅ No variance spikes
- ✅ No major halt events

---

## TROUBLESHOOTING 🔧

### Cap Hit Too Early?
**Symptom:** Hitting $200 cap in first few hours

**Action:**
- Review trade sizing
- Check for execution loops
- Verify profit calculations
- Ensure no duplicate trades

### Halt Triggered Unexpectedly?
**Symptom:** System halts without clear reason

**Action:**
```typescript
const conditions = globalHaltController.getTriggeredConditions();
console.log(conditions); // See which condition triggered
```

### Can't Advance Tiers?
**Symptom:** 5+ days but advancement denied

**Action:**
```typescript
const check = dailyCapLadder.checkAdvancement();
console.log(check.reason); // See what's blocking advancement
```

---

## EMERGENCY PROCEDURES 🚨

### Manual Halt
```typescript
globalHaltController.triggerHalt('Emergency stop', 'critical');
```

### Manual Resume
```typescript
globalHaltController.resume(true);
```

### Reset Cap Ladder (CAUTION)
```typescript
// Only in emergencies - loses performance history
dailyCapLadder.reset();
```

### Force Tier Change (NOT RECOMMENDED)
```typescript
// Bypasses safety checks - only for testing
dailyCapLadder.currentTier = 2;
```

---

## SUCCESS METRICS 📈

### Week 1-2 (Tier 1)
- Daily profit: $100-$200
- Success rate: >70%
- Variance: <15%
- Halts: 0 (expected)

### Week 3-4 (Tier 2)
- Daily profit: $200-$400
- Success rate: >75%
- Variance: <12%
- Halts: 0-1 (acceptable)

### Week 5-6 (Tier 3)
- Daily profit: $400-$800
- Success rate: >80%
- Variance: <10%
- Halts: 0 (required)

### Week 7+ (Tier 4)
- Daily profit: $800-$1,600
- Success rate: >85%
- Variance: <8%
- Halts: 0 (required)

---

## QUICK REFERENCE COMMANDS

```bash
# Verification
npx tsx scripts/verify-production-readiness.ts

# Status Checks (Node REPL)
node
> const { dailyCapLadder, globalHaltController } = require('./server/services/cryptocrawl/risk')
> dailyCapLadder.getCapStatus()
> globalHaltController.getStatus()
> dailyCapLadder.getPerformanceHistory(7)

# Manual Controls
> globalHaltController.triggerHalt('Manual stop', 'critical')
> globalHaltController.resume(true)
> dailyCapLadder.checkAdvancement()
> dailyCapLadder.advanceTier()
```

---

## SUPPORT

### Documentation
- Full report: `SYSTEM_VERIFICATION_REPORT.md`
- Implementation: `IMPLEMENTATION_COMPLETE.md`
- Summary: `VERIFICATION_SUMMARY.md`

### Code Files
- Cap Ladder: `server/services/cryptocrawl/risk/daily-cap-ladder.ts`
- Halt Controller: `server/services/cryptocrawl/risk/global-halt-controller.ts`
- Risk Module: `server/services/cryptocrawl/risk/index.ts`

### Logs
All events logged with component tags:
- `[CAP LADDER]` - Daily cap events
- `[GLOBAL HALT]` - Halt controller events
- `[FAUCET]` - Execution events

---

**READY TO SCALE** ✅

Follow this checklist in order. Complete integration and testing before enabling production scaling.

**Estimated Timeline:**
- Integration: 1-2 hours
- Testing: 30 minutes
- Ready to launch: Same day

**Expected Results:**
- Safe, controlled profit ramping
- Automatic safety enforcement
- Clear visibility into system state

**Good luck!** 🚀
