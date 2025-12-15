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

export function registerSeed(seedUrl: string): AbortSignal {
  // Replace any existing controller for this seed URL
  const existing = seedControllers.get(seedUrl);
  if (existing) {
    try { existing.abort(); } catch { /* ignore */ }
  }
  const controller = new AbortController();
  seedControllers.set(seedUrl, controller);
  return controller.signal;
}

export function abortSeed(seedUrl: string) {
  const controller = seedControllers.get(seedUrl);
  if (!controller) return;
  try { controller.abort(); } catch { /* ignore */ }
}

export function unregisterSeed(seedUrl: string) {
  seedControllers.delete(seedUrl);
}

export function getSeedSignal(seedUrl: string): AbortSignal | null {
  return seedControllers.get(seedUrl)?.signal || null;
}

