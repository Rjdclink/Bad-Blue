export interface SpectraAcquisitionLease {
  signal: AbortSignal;
  release: () => void;
  stopped: () => boolean;
}

interface SessionState {
  stopped: boolean;
  controllers: Set<AbortController>;
  updatedAt: number;
}

const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 24 * 60 * 60_000;

function key(userId: string, sessionId: string): string {
  return `${userId.trim()}:${sessionId.trim()}`;
}

function cleanupExpired(now = Date.now()): void {
  for (const [sessionKey, state] of sessions) {
    if (state.controllers.size > 0) continue;
    if (now - state.updatedAt > SESSION_TTL_MS) {
      sessions.delete(sessionKey);
    }
  }
}

function stateFor(userId: string, sessionId: string): SessionState {
  cleanupExpired();
  const sessionKey = key(userId, sessionId);
  const existing = sessions.get(sessionKey);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const created: SessionState = {
    stopped: false,
    controllers: new Set(),
    updatedAt: Date.now(),
  };
  sessions.set(sessionKey, created);
  return created;
}

export function registerSpectraAcquisitionRequest(
  userId: string,
  sessionId: string,
): SpectraAcquisitionLease {
  const state = stateFor(userId, sessionId);
  const controller = new AbortController();
  state.controllers.add(controller);

  if (state.stopped) {
    controller.abort(new Error('SPECTRA acquisition session stopped'));
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.controllers.delete(controller);
    state.updatedAt = Date.now();
  };

  return {
    signal: controller.signal,
    release,
    stopped: () => state.stopped || controller.signal.aborted,
  };
}

export function stopSpectraAcquisitionSession(
  userId: string,
  sessionId: string,
  reason = 'SPECTRA acquisition stopped by client',
): boolean {
  const normalizedUserId = userId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedUserId || !normalizedSessionId) return false;

  const state = stateFor(normalizedUserId, normalizedSessionId);
  state.stopped = true;
  state.updatedAt = Date.now();

  for (const controller of state.controllers) {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  }
  return true;
}

export function spectraAcquisitionSessionStopped(
  userId: string,
  sessionId: string,
): boolean {
  const existing = sessions.get(key(userId, sessionId));
  return Boolean(existing?.stopped);
}

export function resetSpectraAcquisitionSession(
  userId: string,
  sessionId: string,
): void {
  const sessionKey = key(userId, sessionId);
  const existing = sessions.get(sessionKey);
  if (!existing) return;
  for (const controller of existing.controllers) {
    if (!controller.signal.aborted) {
      controller.abort(new Error('SPECTRA acquisition session reset'));
    }
  }
  sessions.delete(sessionKey);
}
