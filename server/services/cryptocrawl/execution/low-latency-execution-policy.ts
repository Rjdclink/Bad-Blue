export function isSignedRawTransaction(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) && value.length > 132;
}

/**
 * Resolve the first successful submission, not the first settled promise.
 * Promise.race is unsafe for multipath broadcast because a fast relay rejection
 * can beat a slower successful broadcast of the exact same signed payload.
 */
export async function firstSuccessful<T>(submissions: Iterable<PromiseLike<T>>): Promise<T> {
  return Promise.any(submissions);
}

export function normalizePendingNonce(currentPending: number, nextReserved: number | null): number {
  if (!Number.isInteger(currentPending) || currentPending < 0) throw new Error('Pending nonce must be a non-negative integer');
  if (nextReserved === null) return currentPending;
  if (!Number.isInteger(nextReserved) || nextReserved < 0) throw new Error('Reserved nonce must be a non-negative integer');
  return Math.max(currentPending, nextReserved);
}

export function nextNonceAfterReservation(reserved: number): number {
  if (!Number.isInteger(reserved) || reserved < 0) throw new Error('Reserved nonce must be a non-negative integer');
  return reserved + 1;
}
