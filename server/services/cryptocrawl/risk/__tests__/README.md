# Risk Management System - Integration Tests

## Running Tests

### With Jest (if configured)
```bash
npm test -- risk/__tests__/integration.test.ts
```

### Manual Testing
```bash
# Test runtime functionality
node /workspace/test-risk-module.mjs

# Test TypeScript compilation
npx tsc --noEmit
```

## Test Coverage

### Daily Cap Ladder Tests
- ✅ Tier 1 cap enforcement ($200)
- ✅ Performance history tracking
- ✅ Tier advancement validation
- ✅ Manual halt/resume
- ✅ Day rollover detection

### Global Halt Controller Tests
- ✅ Condition registration
- ✅ Threshold monitoring
- ✅ Halt triggering
- ✅ Auto-resume logic
- ✅ Manual resume requirement
- ✅ Halt history tracking

### Integration Tests
- ✅ Cap ladder + halt controller coordination
- ✅ Clean resume after halt
- ✅ Production scenario handling
- ✅ Rapid trade processing
- ✅ Drawdown prevention
- ✅ Audit trail logging

## Real-World Scenarios Tested

1. **Normal Operation**: Trading within cap, no halts
2. **Cap Reached**: Automatic halt at daily limit
3. **Drawdown Triggered**: Emergency shutdown at 15%
4. **Manual Override**: Operator-initiated halt
5. **Auto-Resume**: System recovery after anomaly clears
6. **Multi-Condition**: Multiple halt triggers simultaneously
7. **Tier Advancement**: 5-day stability validation

## Expected Results

All tests should pass with:
- ✅ Zero runtime errors
- ✅ Correct halt/resume behavior
- ✅ Accurate profit tracking
- ✅ Proper tier advancement logic
- ✅ Complete audit trails

## Production Verification

Before deploying to production:

1. Run all unit tests
2. Run integration tests
3. Run `test-risk-module.mjs` for runtime verification
4. Run `scripts/verify-production-readiness.ts` for system check
5. Verify TypeScript compilation with `npx tsc --noEmit`

## Troubleshooting

### Import Errors
- Ensure all imports use `.js` extensions (ESM requirement)
- Verify `logger.js` is accessible
- Check `tsconfig.json` for correct module resolution

### Runtime Errors
- Check Node.js version (requires 20.x)
- Verify all dependencies installed
- Ensure `logs/` directory exists

### Test Failures
- Clear old state with `capLadder.reset()` and `haltController.reset()`
- Check for timing issues in async tests
- Verify test isolation (beforeEach/afterEach)
