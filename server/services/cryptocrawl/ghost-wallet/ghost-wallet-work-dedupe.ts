function dedupeWindowMs(): number {
  const configured = Number(process.env.GHOST_WALLET_WORK_DEDUPE_WINDOW_MS || 15_000);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(120_000, Math.trunc(configured)))
    : 15_000;
}

/**
 * Collapse event bursts into one durable work row per semantic key and freshness
 * window. A new window creates a new key, so this never permanently suppresses
 * later remeasurement/reverification.
 */
export function ghostWalletWorkDedupeBucket(now = Date.now()): number {
  return Math.floor(now / dedupeWindowMs());
}

export const GHOST_WALLET_WORK_DEDUPE_POLICY = {
  eventBurstCollapse: true,
  permanentSuppression: false,
  windowMs: dedupeWindowMs(),
} as const;
