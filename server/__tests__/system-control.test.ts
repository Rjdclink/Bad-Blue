/**
 * Minimal validation for OBVIOUS SystemControl.
 * Run with: npm exec tsx server/__tests__/system-control.test.ts
 */

import assert from 'node:assert';
import { ControlCheck, SystemControl } from '../../shared/system-control';

function resetState(reason = 'System has not been enabled by an operator') {
  SystemControl.turnOff(reason);
  SystemControl.resetChecks();
}

console.log('SystemControl - OBVIOUS design checks');

// Safe default: OFF until an operator turns it on
resetState();
assert.strictEqual(SystemControl.isOn(), false);
assert.match(SystemControl.whyOff(), /not been enabled/i);

// When enabled and no checks fail, system turns ON
SystemControl.turnOn('Operator enabled for test');
SystemControl.resetChecks();
assert.strictEqual(SystemControl.isOn(), true);
assert.strictEqual(SystemControl.whyOff(), 'System is ON');

// A single failing check blocks the system and explains why
const failingCheck: ControlCheck = {
  name: 'database_ready',
  passes: () => false,
  reason: 'Database not ready',
};

SystemControl.turnOn('Operator enabled for test');
SystemControl.setChecks([failingCheck]);
assert.strictEqual(SystemControl.isOn(), false);
assert.strictEqual(SystemControl.whyOff(), 'Database not ready');

// All checks passing keeps the system ON
const passingChecks: ControlCheck[] = [
  { name: 'database_ready', passes: () => true, reason: 'Database not ready' },
  { name: 'cache_ready', passes: () => true, reason: 'Cache not ready' },
];

SystemControl.turnOn('Operator enabled for test');
SystemControl.setChecks(passingChecks);
assert.strictEqual(SystemControl.isOn(), true);
assert.strictEqual(SystemControl.whyOff(), 'System is ON');

console.log('✓ SystemControl.isOn() and whyOff() behave as expected');
