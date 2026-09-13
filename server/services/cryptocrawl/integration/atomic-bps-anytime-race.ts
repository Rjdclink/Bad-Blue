export interface AtomicBpsAnytimeRaceResult<T> {
  best: T | null;
  completed: number;
  rejected: number;
  ignoredStragglers: number;
  stoppedOnAcceptable: boolean;
  stoppedOnDeadline: boolean;
  elapsedMs: number;
}

export type AtomicBpsAnytimeConsumed<T> =
  | { index: number; status: 'fulfilled'; value: T }
  | { index: number; status: 'rejected'; error: unknown };

type Settled<T> = AtomicBpsAnytimeConsumed<T>;

interface PendingState<T> {
  settled: boolean;
  consumed: boolean;
  outcome: Settled<T> | null;
  promise: Promise<Settled<T>>;
}

function deadlineSignal(deadlineAt: number): {
  promise: Promise<{ deadline: true }>;
  cancel: () => void;
} {
  let timer: NodeJS.Timeout | null = null;
  const promise = new Promise<{ deadline: true }>(resolve => {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    timer = setTimeout(() => resolve({ deadline: true }), remainingMs);
    timer.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Deadline-aware anytime collector for the Atomic-BPS hot path.
 *
 * All probes start concurrently. Results are consumed in completion order rather
 * than waiting for the slowest probe. The first exact acceptable incumbent may
 * terminate the race immediately; any probes that happened to settle in the same
 * event-loop turn are drained before return so a strictly better co-settled result
 * can replace it without adding an artificial wait. Outstanding probes are allowed
 * to finish in the background, but their late results cannot delay or overwrite the
 * already-returned incumbent.
 *
 * This helper owns no economic rules: callers provide acceptability and comparison.
 */
export async function runAtomicBpsAnytimeRace<T>(input: {
  tasks: readonly Promise<T>[];
  deadlineAt: number;
  acceptable: (value: T) => boolean;
  better: (current: T | null, candidate: T) => T;
  onConsumed?: (outcome: AtomicBpsAnytimeConsumed<T>) => void;
}): Promise<AtomicBpsAnytimeRaceResult<T>> {
  const startedAt = Date.now();
  if (input.tasks.length === 0 || input.deadlineAt <= startedAt) {
    return {
      best: null,
      completed: 0,
      rejected: 0,
      ignoredStragglers: input.tasks.length,
      stoppedOnAcceptable: false,
      stoppedOnDeadline: input.deadlineAt <= startedAt,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const states: PendingState<T>[] = input.tasks.map((task, index) => {
    const state: PendingState<T> = {
      settled: false,
      consumed: false,
      outcome: null,
      promise: Promise.resolve({ index, status: 'rejected', error: new Error('uninitialized') } as Settled<T>),
    };
    state.promise = task.then(
      (value): Settled<T> => ({ index, status: 'fulfilled', value }),
      (error): Settled<T> => ({ index, status: 'rejected', error }),
    ).then(outcome => {
      state.settled = true;
      state.outcome = outcome;
      return outcome;
    });
    return state;
  });

  let best: T | null = null;
  let completed = 0;
  let rejected = 0;
  let stoppedOnAcceptable = false;
  let stoppedOnDeadline = false;

  const consume = (outcome: Settled<T>) => {
    const state = states[outcome.index];
    if (state.consumed) return;
    state.consumed = true;
    completed += 1;
    input.onConsumed?.(outcome);
    if (outcome.status === 'rejected') {
      rejected += 1;
      return;
    }
    best = input.better(best, outcome.value);
  };

  const deadline = deadlineSignal(input.deadlineAt);
  try {
    while (completed < states.length) {
      if (Date.now() >= input.deadlineAt) {
        stoppedOnDeadline = true;
        break;
      }

      const active = states.filter(state => !state.consumed).map(state => state.promise);
      const outcome = await Promise.race<Settled<T> | { deadline: true }>([
        ...active,
        deadline.promise,
      ]);
      if ('deadline' in outcome) {
        stoppedOnDeadline = true;
        break;
      }
      consume(outcome);

      if (best !== null && input.acceptable(best)) {
        // Give already-resolved sibling promises one microtask turn to publish
        // their state, then consume only those that are already settled. This is
        // not a wait-for-stragglers barrier.
        await Promise.resolve();
        for (const state of states) {
          if (state.settled && !state.consumed && state.outcome) consume(state.outcome);
        }
        stoppedOnAcceptable = true;
        break;
      }
    }
  } finally {
    deadline.cancel();
  }

  const ignoredStragglers = states.filter(state => !state.consumed).length;
  return {
    best,
    completed,
    rejected,
    ignoredStragglers,
    stoppedOnAcceptable,
    stoppedOnDeadline,
    elapsedMs: Date.now() - startedAt,
  };
}
