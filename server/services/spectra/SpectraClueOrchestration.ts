/** Keep independent clue lanes available when one optional collector throws. */
export async function isolateSpectraClue<T>(
  collect: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await collect();
  } catch {
    // Provider exceptions must not expose private request details or cancel
    // other sources; callers supply a typed failure status for diagnostics.
    return fallback;
  }
}
