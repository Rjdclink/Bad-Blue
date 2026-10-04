import { pool } from '../../db';

export interface SpectraAcquisitionLease {
  signal: AbortSignal;
  cancel: (reason?: string) => void;
  release: () => void;
  stopped: () => boolean;
}

interface SessionState {
  stopped: boolean;
  controllers: Set<AbortController>;
  updatedAt: number;
  pollTimer?: NodeJS.Timeout;
  pollInFlight: boolean;
}

const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 24 * 60 * 60_000;
const SHARED_STOP_POLL_MS = 500;

function key(userId: string, sessionId: string): string {
  return `${userId.trim()}:${sessionId.trim()}`;
}

function cleanupExpired(now = Date.now()): void {
  for (const [sessionKey, state] of sessions) {
    if (state.controllers.size > 0) continue;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = undefined;
    }
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
    pollInFlight: false,
  };
  sessions.set(sessionKey, created);
  return created;
}

function abortLocalState(
  state: SessionState,
  reason: string,
): void {
  state.stopped = true;
  state.updatedAt = Date.now();
  for (const controller of state.controllers) {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  }
}

async function sharedStopped(
  userId: string,
  sessionId: string,
): Promise<{ stopped: boolean; reason?: string }> {
  const result = await pool.query(
    `SELECT stopped_at, stop_reason
     FROM public.spectra_acquisition_control
     WHERE user_id = $1 AND session_id = $2
     LIMIT 1`,
    [userId.trim(), sessionId.trim()],
  );
  const row = result.rows[0];
  return {
    stopped: Boolean(row?.stopped_at),
    reason: typeof row?.stop_reason === 'string' && row.stop_reason.trim()
      ? row.stop_reason.trim()
      : undefined,
  };
}

function startSharedStopPolling(
  userId: string,
  sessionId: string,
  state: SessionState,
): void {
  if (state.pollTimer || state.controllers.size === 0) return;

  state.pollTimer = setInterval(() => {
    if (
      state.stopped
      || state.pollInFlight
      || state.controllers.size === 0
    ) return;

    state.pollInFlight = true;
    void sharedStopped(userId, sessionId)
      .then(result => {
        if (result.stopped) {
          abortLocalState(
            state,
            result.reason || 'SPECTRA acquisition stopped on another replica',
          );
        }
      })
      .catch(() => {
        // The route-level resource governor already treats PostgreSQL as a
        // critical dependency. A transient poll failure must not create a
        // second independent cancellation policy inside an in-flight request.
      })
      .finally(() => {
        state.pollInFlight = false;
      });
  }, SHARED_STOP_POLL_MS);
  state.pollTimer.unref?.();
}

function stopSharedStopPollingIfIdle(state: SessionState): void {
  if (state.controllers.size > 0 || !state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = undefined;
}

export async function assertSpectraAcquisitionSessionActive(
  userId: string,
  sessionId: string,
): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedUserId || !normalizedSessionId) {
    throw new Error('SPECTRA acquisition session identity is required.');
  }

  const local = sessions.get(key(normalizedUserId, normalizedSessionId));
  if (local?.stopped) {
    throw new Error('SPECTRA acquisition session stopped');
  }

  const result = await sharedStopped(normalizedUserId, normalizedSessionId);
  if (result.stopped) {
    const state = stateFor(normalizedUserId, normalizedSessionId);
    abortLocalState(
      state,
      result.reason || 'SPECTRA acquisition session stopped',
    );
    throw new Error(result.reason || 'SPECTRA acquisition session stopped');
  }
}

export function registerSpectraAcquisitionRequest(
  userId: string,
  sessionId: string,
): SpectraAcquisitionLease {
  const normalizedUserId = userId.trim();
  const normalizedSessionId = sessionId.trim();
  const state = stateFor(normalizedUserId, normalizedSessionId);
  const controller = new AbortController();
  state.controllers.add(controller);

  if (state.stopped) {
    controller.abort(new Error('SPECTRA acquisition session stopped'));
  } else {
    startSharedStopPolling(normalizedUserId, normalizedSessionId, state);
  }

  const cancel = (reason = 'SPECTRA acquisition request cancelled') => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  };

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.controllers.delete(controller);
    state.updatedAt = Date.now();
    stopSharedStopPollingIfIdle(state);
  };

  return {
    signal: controller.signal,
    cancel,
    release,
    stopped: () => state.stopped || controller.signal.aborted,
  };
}

export async function stopSpectraAcquisitionSession(
  userId: string,
  sessionId: string,
  reason = 'SPECTRA acquisition stopped by client',
): Promise<boolean> {
  const normalizedUserId = userId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedUserId || !normalizedSessionId) return false;

  const state = stateFor(normalizedUserId, normalizedSessionId);
  abortLocalState(state, reason);

  await pool.query(
    `INSERT INTO public.spectra_acquisition_control
       (user_id, session_id, stopped_at, stop_reason, updated_at)
     VALUES ($1, $2, now(), $3, now())
     ON CONFLICT (user_id, session_id)
     DO UPDATE SET
       stopped_at = EXCLUDED.stopped_at,
       stop_reason = EXCLUDED.stop_reason,
       updated_at = now()`,
    [normalizedUserId, normalizedSessionId, reason.slice(0, 2_000)],
  );
  return true;
}

export function spectraAcquisitionSessionStopped(
  userId: string,
  sessionId: string,
): boolean {
  const existing = sessions.get(key(userId, sessionId));
  return Boolean(existing?.stopped);
}

export async function spectraAcquisitionSessionStoppedShared(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const local = spectraAcquisitionSessionStopped(userId, sessionId);
  if (local) return true;
  return (await sharedStopped(userId, sessionId)).stopped;
}

export async function resetSpectraAcquisitionSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedSessionId = sessionId.trim();
  const sessionKey = key(normalizedUserId, normalizedSessionId);
  const existing = sessions.get(sessionKey);

  if (existing) {
    for (const controller of existing.controllers) {
      if (!controller.signal.aborted) {
        controller.abort(new Error('SPECTRA acquisition session reset'));
      }
    }
    if (existing.pollTimer) clearInterval(existing.pollTimer);
    sessions.delete(sessionKey);
  }

  if (normalizedUserId && normalizedSessionId) {
    await pool.query(
      `DELETE FROM public.spectra_acquisition_control
       WHERE user_id = $1 AND session_id = $2`,
      [normalizedUserId, normalizedSessionId],
    );
  }
}
