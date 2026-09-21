import { throwIfPantheonAborted } from './PantheonDeadline';

export async function runPantheonBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Pantheon scheduler concurrency must be a positive integer');
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runner = async () => {
    while (true) {
      throwIfPantheonAborted(signal);
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => runner(),
  ));
  return results;
}
