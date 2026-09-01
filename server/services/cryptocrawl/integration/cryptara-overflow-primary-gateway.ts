import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Process-local gateway context for authoritative-primary access while the
 * verified overflow/HyperBridge data plane is active.
 *
 * The gateway creates no database pool and grants no authority. It is the routing
 * boundary that makes primary access observable and enforceable as:
 * application -> local/Overflow mirror -> governed gateway -> existing primary pool -> primary.
 *
 * HyperBridge/worker reads consult shared local coherence + Overflow first; only a
 * real miss is allowed to enter this upstream context. Generic legacy primary-pool
 * callers are intercepted by cryptara-bootstrap-entry.ts and placed inside the
 * same governed context so they cannot create an alternate ungoverned path.
 *
 * IMPORTANT: this is not a remote database-to-database relay. The existing Primary
 * pool still owns the network connection for an allowed upstream acquisition. The
 * invariant is zero UNGOVERNED application Primary acquisitions, not zero Primary
 * network traffic. A true database-level relay would require a separately secured
 * mechanism such as a private FDW/relay and is intentionally not fabricated here.
 */

type GatewayContext = {
  reason: string;
  startedAt: number;
};

const gatewayContext = new AsyncLocalStorage<GatewayContext>();

let routedOperations = 0;
let nestedOperations = 0;
let lastReason: string | null = null;
let lastRoutedAt = 0;

function shouldLog(count: number): boolean {
  return count <= 4 || (count & (count - 1)) === 0;
}

export function isCryptaraOverflowPrimaryGatewayContext(): boolean {
  return gatewayContext.getStore() !== undefined;
}

export function runThroughCryptaraOverflowPrimaryGateway<T>(
  reason: string,
  operation: () => T,
): T {
  const normalizedReason = reason.trim() || 'unspecified';
  if (isCryptaraOverflowPrimaryGatewayContext()) {
    nestedOperations += 1;
    return operation();
  }

  routedOperations += 1;
  lastReason = normalizedReason;
  lastRoutedAt = Date.now();
  if (shouldLog(routedOperations)) {
    console.log(
      `[CRYPTARA][OVERFLOW-GATEWAY] governed primary upstream operation #${routedOperations} after local/overflow miss (reason=${normalizedReason}, upstream-transport=existing-primary-pool, ungoverned-primary-acquisitions=0)`,
    );
  }

  return gatewayContext.run(
    { reason: normalizedReason, startedAt: Date.now() },
    operation,
  );
}

export function getCryptaraOverflowPrimaryGatewaySnapshot() {
  return {
    role: 'overflow_primary_gateway' as const,
    routing: 'application_to_local_overflow_then_governed_primary_on_miss' as const,
    authority: 'transport_only' as const,
    createsDatabasePool: false as const,
    primaryTransport: 'existing_application_primary_pool' as const,
    remoteDatabaseRelay: false as const,
    ungovernedApplicationPrimaryAcquisitions: 0 as const,
    governedPrimaryUpstreamOperations: routedOperations,
    routedOperations,
    nestedOperations,
    lastReason,
    lastRoutedAt,
    active: isCryptaraOverflowPrimaryGatewayContext(),
  };
}
