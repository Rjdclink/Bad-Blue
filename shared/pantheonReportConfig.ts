export type PantheonSearchDepth = 1 | 2 | 3 | 4;

export const PANTHEON_REPORT_DURATIONS_MS: Record<PantheonSearchDepth, number> = {
  1: 5 * 60_000,
  2: 10 * 60_000,
  3: 20 * 60_000,
  4: 30 * 60_000,
};

export const PANTHEON_REPORT_DURATION_LABELS: Record<PantheonSearchDepth, string> = {
  1: '5 minutes',
  2: '10 minutes',
  3: '20 minutes',
  4: '30 minutes',
};

export const PANTHEON_PRIMARY_CRAWLERS = [
  'startrek',
  'birdofprey',
  'sixdegrees',
  'cerberus',
  'blizzard',
  'lich',
] as const;

export const PANTHEON_SECONDARY_CRAWLERS = [
  'hydra',
  'wraith',
  'ice',
  'farm',
  'phantom',
  'nova',
] as const;

export function normalizePantheonSearchDepth(value: unknown): PantheonSearchDepth {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 4 ? parsed as PantheonSearchDepth : 1;
}

export function getPantheonReportDurationMs(depth: unknown): number {
  return PANTHEON_REPORT_DURATIONS_MS[normalizePantheonSearchDepth(depth)];
}

export function getPantheonReportDurationLabel(depth: unknown): string {
  return PANTHEON_REPORT_DURATION_LABELS[normalizePantheonSearchDepth(depth)];
}
