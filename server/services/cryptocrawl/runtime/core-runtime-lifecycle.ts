export interface CryptoCrawlerCoreLifecycleDependencies {
  startDiscovery: () => void;
  stopDiscovery: () => void;
  startScheduler: () => void;
  stopScheduler: () => void;
}

export interface CryptoCrawlerCoreLifecycle {
  start(): boolean;
  stop(): boolean;
  isStarted(): boolean;
}

/**
 * Testable lifecycle primitive for the topology-independent CryptoCrawler core.
 *
 * The core consists only of canonical measured discovery and the canonical
 * execution scheduler. Optional provider/topology services (Alchemy, mempool,
 * bridge, zero-capital gas, etc.) are deliberately outside this authority so
 * their degradation cannot prevent CEX_CEX discovery from running.
 */
export function createCryptoCrawlerCoreLifecycle(
  dependencies: CryptoCrawlerCoreLifecycleDependencies,
): CryptoCrawlerCoreLifecycle {
  let started = false;

  return {
    start(): boolean {
      if (started) return false;
      try {
        dependencies.startDiscovery();
        dependencies.startScheduler();
        started = true;
        return true;
      } catch (error) {
        // Fail closed and roll back any partial core startup. The concrete start
        // methods are idempotent, so both stop calls are safe here.
        try { dependencies.stopScheduler(); } catch { /* preserve original error */ }
        try { dependencies.stopDiscovery(); } catch { /* preserve original error */ }
        started = false;
        throw error;
      }
    },

    stop(): boolean {
      if (!started) return false;
      // Stop admission before discovery so no new execution can be selected
      // while the candidate producer is being torn down.
      dependencies.stopScheduler();
      dependencies.stopDiscovery();
      started = false;
      return true;
    },

    isStarted(): boolean {
      return started;
    },
  };
}
