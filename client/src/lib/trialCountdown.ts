const HOUR_MS = 60 * 60 * 1000;

// Anchor the server's time remaining to the browser's monotonic clock. Delayed
// timer callbacks and changes to the device's wall clock cannot extend it.
export function trialRemainingAt(serverRemainingMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil(serverRemainingMs - Math.max(0, elapsedMs)));
}

export function trialReminder(remainingMs: number): { key: string; message: string } | null {
  if (remainingMs <= 0) return null;
  if (remainingMs <= HOUR_MS) return { key: 'one-hour', message: 'Your free trial ends within an hour.' };
  if (remainingMs <= 24 * HOUR_MS) return { key: 'one-day', message: 'Your free trial ends within a day.' };
  if (remainingMs <= 48 * HOUR_MS) return { key: 'two-days', message: 'Your free trial ends within two days.' };
  return null;
}

export function trialCountdownLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Trial ended';
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const minuteRemainder = minutes % 60;
  if (days) return `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} ${hours === 1 ? 'hour' : 'hours'}` : ''} remaining`;
  if (hours) return `${hours} ${hours === 1 ? 'hour' : 'hours'}${minuteRemainder ? ` ${minuteRemainder} ${minuteRemainder === 1 ? 'minute' : 'minutes'}` : ''} remaining`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`;
}
