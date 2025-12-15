/**
 * Seed-level abort bus
 *
 * Purpose:
 * - Allow bounded fan-out per seed (4 crawlers running concurrently)
 * - First successful crawler wins; remaining crawlers must abort immediately
 *
 * This avoids adding extra parameters to the mandated crawlSeed(seedUrl, timeoutMs) signature.
 */
const seedControllers = new Map<string, AbortController>();
const seedFingerprints = new Map<string, SeedFingerprint>();

export type SeedFingerprint = {
  host: string;
  userAgent: string;
  acceptLanguage: string;
  accept: string;
};

export function registerSeed(seedUrl: string, fingerprint?: SeedFingerprint): AbortSignal {
  // Replace any existing controller for this seed URL
  const existing = seedControllers.get(seedUrl);
  if (existing) {
    try { existing.abort(); } catch { /* ignore */ }
  }
  const controller = new AbortController();
  seedControllers.set(seedUrl, controller);
  if (fingerprint) {
    seedFingerprints.set(seedUrl, fingerprint);
  } else {
    seedFingerprints.delete(seedUrl);
  }
  return controller.signal;
}

export function abortSeed(seedUrl: string) {
  const controller = seedControllers.get(seedUrl);
  if (!controller) return;
  try { controller.abort(); } catch { /* ignore */ }
}

export function unregisterSeed(seedUrl: string) {
  seedControllers.delete(seedUrl);
  seedFingerprints.delete(seedUrl);
}

export function getSeedSignal(seedUrl: string): AbortSignal | null {
  return seedControllers.get(seedUrl)?.signal || null;
}

export function getSeedFingerprint(seedUrl: string): SeedFingerprint | null {
  return seedFingerprints.get(seedUrl) || null;
}

