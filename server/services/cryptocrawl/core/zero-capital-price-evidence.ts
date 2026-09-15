export interface ZeroCapitalPriceEvidence {
  readonly priceUsd: number;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly source: string;
  readonly confidence?: number;
  readonly blockNumber?: string | number;
  readonly roundId?: string;
}

/**
 * Returns price evidence only when it is structurally valid and still fresh.
 * This is deliberately a pure in-memory check: it never performs I/O or waits
 * for a provider, preserving the zero-latency APE hot-path contract.
 */
export function getFreshZeroCapitalPriceEvidence(
  evidence: Readonly<ZeroCapitalPriceEvidence> | null | undefined,
  now = Date.now(),
): Readonly<ZeroCapitalPriceEvidence> | null {
  if (!evidence) return null;

  const priceUsd = Number(evidence.priceUsd);
  const observedAt = Number(evidence.observedAt);
  const expiresAt = Number(evidence.expiresAt);
  const source = String(evidence.source ?? '').trim();

  if (
    !Number.isFinite(priceUsd) ||
    priceUsd <= 0 ||
    !Number.isFinite(observedAt) ||
    observedAt < 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= observedAt ||
    expiresAt <= now ||
    source.length === 0
  ) {
    return null;
  }

  return evidence;
}

/**
 * Creates immutable evidence on the write side so readers can reuse the same
 * object without copying it in Stage 1 or APE.
 */
export function createZeroCapitalPriceEvidence(
  evidence: ZeroCapitalPriceEvidence,
): Readonly<ZeroCapitalPriceEvidence> {
  return Object.freeze({ ...evidence });
}
