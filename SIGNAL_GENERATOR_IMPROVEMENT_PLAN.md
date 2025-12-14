# SIGNAL GENERATOR IMPROVEMENT PLAN

**Objective:** Improve signal generator so it reliably passes faucet mesh  
**Mode:** BUILD MODE - Technical Focus Only  
**Status:** IN PROGRESS

---

## PROBLEM ANALYSIS

### Current Signal Generator
- Uses maker-only fees (0.08%)
- Calculates: baseAmount × makerFeeRate = 0.0005 × 0.0008 = 0.0000004 ETH
- Total fees: 0.0001 (gas) + 0.0000004 (exchange) = 0.0001004 ETH
- Required spread: 0.0001004 × 2.0 = 0.0002008 ETH
- Profit estimate: 0.0002008 × 1.1 = 0.00022088 ETH

### Faucet Mesh Filter
- Default: Uses 0.3% exchange fee (not maker-only)
- Calculates: profitEstimate × 0.003 = 0.00022088 × 0.003 = 0.00000066264 ETH
- Total fees: 0.0001 (gas) + 0.00000066264 (exchange) = 0.00010066264 ETH
- Required spread: 0.00010066264 × 1.5 = 0.00015099396 ETH

### Issue Identified
1. **Fee Calculation Mismatch:** Signal generator uses maker-only (0.08%), faucet mesh uses blended (0.3%)
2. **TEST_SIGNAL Override:** Faucet mesh has override logic for test signals, but may not be properly triggered
3. **Spread Multiplier Mismatch:** Signal generator uses 2.0×, faucet mesh default uses 1.5×

---

## SOLUTION APPROACH

### Option 1: Align Signal Generator with Faucet Mesh Defaults
- Use same fee calculation as faucet mesh (0.3% exchange fee)
- Use same spread multiplier (1.5×)
- Ensure profit estimate clears the required spread

### Option 2: Ensure TEST_SIGNAL Override Works
- Verify test signal metadata is properly set
- Ensure faucet mesh recognizes test signals
- Use maker-only fees and 2.0× multiplier via override

### Option 3: Increase Profit Estimate Buffer
- Keep current calculation
- Increase buffer from 10% to larger margin
- Ensure it clears both default and override thresholds

---

## RECOMMENDED SOLUTION

**Use Option 1 + Option 2 Combined:**
1. Ensure TEST_SIGNAL metadata is properly set (already done)
2. Verify faucet mesh override logic works correctly
3. If override fails, fall back to matching faucet mesh defaults
4. Add safety margin to ensure reliable pass

---

## IMPLEMENTATION PLAN

### Step 1: Verify TEST_SIGNAL Override Logic
- Check if `signal.metadata.testSignal === true` is properly checked
- Verify `signal.metadata.useMakerOnlyFees === true` is used
- Confirm `testSignalSpreadMultiplier` (2.0) is applied

### Step 2: Improve Signal Generator
- Ensure metadata is properly set
- Calculate profit estimate to clear both default and override thresholds
- Add safety margin (e.g., 20% buffer instead of 10%)

### Step 3: Test Reliability
- Generate multiple test signals
- Verify all pass faucet mesh
- Measure pass rate (target: 100%)

---

## TECHNICAL DETAILS

### Current Signal Metadata
```typescript
metadata: {
  exchange: 'uniswap-v3',
  size: 'dust',
  testSignal: true,
  useMakerOnlyFees: true,
  spreadMultiplier: 2.0,
  deterministic: true,
}
```

### Faucet Mesh Override Logic (Expected)
```typescript
const isTestSignal = signal.metadata?.testSignal === true;
const useMakerOnlyFees = signal.metadata?.useMakerOnlyFees === true;
const spreadMultiplier = (isTestSignal && allowTestSignalOverride)
  ? testSignalSpreadMultiplier  // 2.0
  : minSpreadMultiplier;        // 1.5
```

### Required Profit Estimate Calculation
- **For Override (Maker-Only, 2.0×):**
  - Exchange fee: baseAmount × 0.0008 = 0.0000004 ETH
  - Total fees: 0.0001 + 0.0000004 = 0.0001004 ETH
  - Required spread: 0.0001004 × 2.0 = 0.0002008 ETH
  - Profit estimate: 0.0002008 × 1.2 = 0.00024096 ETH (20% buffer)

- **For Default (Blended, 1.5×):**
  - Exchange fee: profitEstimate × 0.003 (circular - need to solve)
  - Approximate: profitEstimate ≈ 0.00015 ETH minimum
  - With 20% buffer: 0.00018 ETH

- **Safe Target:** Use max(override requirement, default requirement) × 1.2
  - Target: 0.00024096 ETH (covers both)

---

## NEXT STEPS

1. **Review faucet mesh filter code** - Verify override logic is correct
2. **Update signal generator** - Ensure profit estimate clears threshold
3. **Test** - Generate signals and verify pass rate
4. **Iterate** - Adjust until 100% pass rate achieved

---

**Plan Created By:** Composer (AI Assistant)  
**Mode:** BUILD MODE  
**Focus:** Signal Quality → Faucet Mesh Pass Rate  
**Status:** READY FOR IMPLEMENTATION
