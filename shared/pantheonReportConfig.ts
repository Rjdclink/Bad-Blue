export type PantheonSearchDepth = 1 | 2 | 3;

export const PANTHEON_REPORT_DURATIONS_MS: Record<PantheonSearchDepth, number> = {
  1: 10 * 60_000,
  2: 20 * 60_000,
  3: 30 * 60_000,
};

export const PANTHEON_REPORT_DURATION_LABELS: Record<PantheonSearchDepth, string> = {
  1: '10 minutes',
  2: '20 minutes',
  3: '30 minutes',
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
  return parsed >= 1 && parsed <= 3 ? parsed as PantheonSearchDepth : 1;
}

export function getPantheonReportDurationMs(depth: unknown): number {
  return PANTHEON_REPORT_DURATIONS_MS[normalizePantheonSearchDepth(depth)];
}

export function getPantheonReportDurationLabel(depth: unknown): string {
  return PANTHEON_REPORT_DURATION_LABELS[normalizePantheonSearchDepth(depth)];
}
