import assert from 'node:assert/strict';
import {
  registerSpectraAcquisitionRequest,
  resetSpectraAcquisitionSession,
  spectraAcquisitionSessionStopped,
  stopSpectraAcquisitionSession,
} from '../server/services/spectra/SpectraAcquisitionControl';

const userId = 'verify-spectra-user';
const sessionId = 'verify-spectra-session';

resetSpectraAcquisitionSession(userId, sessionId);

const first = registerSpectraAcquisitionRequest(userId, sessionId);
assert.equal(first.signal.aborted, false, 'new acquisition lease should start active');
assert.equal(first.stopped(), false, 'new acquisition lease should not report stopped');

assert.equal(
  stopSpectraAcquisitionSession(userId, sessionId, 'verification stop'),
  true,
  'stop should accept a valid session',
);
assert.equal(first.signal.aborted, true, 'hard stop should abort an in-flight lease');
assert.equal(first.stopped(), true, 'hard stop should be visible through the lease');
assert.equal(
  spectraAcquisitionSessionStopped(userId, sessionId),
  true,
  'session stop state should persist across requests',
);
first.release();

const delayed = registerSpectraAcquisitionRequest(userId, sessionId);
assert.equal(
  delayed.signal.aborted,
  true,
  'a delayed request arriving after hard stop must be rejected immediately',
);
delayed.release();

resetSpectraAcquisitionSession(userId, sessionId);
assert.equal(
  spectraAcquisitionSessionStopped(userId, sessionId),
  false,
  'reset should clear the stopped session state for a new investigation',
);

const second = registerSpectraAcquisitionRequest(userId, sessionId);
assert.equal(second.signal.aborted, false, 'reset session should accept a fresh lease');
second.cancel('verification request cancel');
assert.equal(second.signal.aborted, true, 'request-scoped cancel should abort only the lease');
assert.equal(
  spectraAcquisitionSessionStopped(userId, sessionId),
  false,
  'request-scoped cancellation must not permanently stop the session',
);
second.release();
resetSpectraAcquisitionSession(userId, sessionId);

console.log('SPECTRA continuous acquisition control verification passed');
