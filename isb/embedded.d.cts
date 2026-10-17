import type { RequestHandler } from "express";

/** Optional, fail-open ISB observer. It never authenticates or blocks real requests. */
export function createEmbeddedISB(options?: Record<string, unknown>): {
  middleware: RequestHandler;
  stop(): void;
  snapshot(): {
    mode: "passive";
    enforcement: "none";
    action: "observe";
    observed: number;
    dropped: number;
    queued: number;
    softSignals: number;
    bubbles: Record<string, number | string>;
  };
};
