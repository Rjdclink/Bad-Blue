import assert from 'node:assert/strict';
import { shouldRunSpectraClaudeBackground } from '../server/services/spectra/SpectraClaudeBudget';

assert.equal(shouldRunSpectraClaudeBackground({}), true);
assert.equal(shouldRunSpectraClaudeBackground({ sessionId: 'existing-session' }), true,
  'a manual follow-up retains full research');
assert.equal(shouldRunSpectraClaudeBackground({ refreshOnly: true }), true,
  'a new investigation cannot skip its initial research');
assert.equal(shouldRunSpectraClaudeBackground({ refreshOnly: true, sessionId: 'existing-session' }), false,
  'the automatic public-record refresh must not repeat paid background research');
console.log('SPECTRA automatic refresh avoids repeat Claude background calls.');
