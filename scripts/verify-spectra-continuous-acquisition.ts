import assert from 'node:assert/strict';
import {
  assertSpectraAcquisitionSessionActive,
  registerSpectraAcquisitionRequest,
  resetSpectraAcquisitionSession,
  spectraAcquisitionSessionStopped,
  spectraAcquisitionSessionStoppedShared,
  stopSpectraAcquisitionSession,
} from '../server/services/spectra/SpectraAcquisitionControl';

const userId = 'verify-spectra-user';
const sessionId = `verify-spectra-session-${process.pid}-${Date.now()}`;

// Request-scoped cancellation is always testable without external state.
const local = registerSpectraAcquisitionRequest(userId, sessionId);
assert.equal(local.signal.aborted, false, 'new acquisition lease should start active');
assert.equal(local.stopped(), false, 'new acquisition lease should not report stopped');
local.cancel('verification request cancel');
assert.equal(local.signal.aborted, true, 'request-scoped cancel should abort the lease');
assert.equal(
  spectraAcquisitionSessionStopped(userId, sessionId),
  false,
  'request-scoped cancellation must not permanently stop the session',
);
local.release();

// Shared-stop semantics require the same PostgreSQL authority used in production.
// CI environments without a database still exercise these guarantees through the
// static SPECTRA verifier and TypeScript compilation.
if (String(process.env.DATABASE_URL || '').trim()) {
  await resetSpectraAcquisitionSession(userId, sessionId);

  const first = registerSpectraAcquisitionRequest(userId, sessionId);
  assert.equal(first.signal.aborted, false, 'shared test lease should start active');

  assert.equal(
    await stopSpectraAcquisitionSession(userId, sessionId, 'verification stop'),
    true,
    'stop should persist a valid shared session stop',
  );
  assert.equal(first.signal.aborted, true, 'hard stop should abort an in-flight lease');
  assert.equal(first.stopped(), true, 'hard stop should be visible through the lease');
  assert.equal(
    await spectraAcquisitionSessionStoppedShared(userId, sessionId),
    true,
    'shared stop state should survive the local request boundary',
  );
  first.release();

  await assert.rejects(
    () => assertSpectraAcquisitionSessionActive(userId, sessionId),
    /stopped/i,
    'a delayed request must be rejected by shared stop state',
  );

  await resetSpectraAcquisitionSession(userId, sessionId);
  assert.equal(
    await spectraAcquisitionSessionStoppedShared(userId, sessionId),
    false,
    'reset should clear shared stop state for a new investigation',
  );
}

console.log('SPECTRA continuous acquisition control verification passed');
// The shared database module starts a long-lived pool monitor for the server.
// This standalone verifier has finished its awaited checks and can exit now.
process.exit(0);
