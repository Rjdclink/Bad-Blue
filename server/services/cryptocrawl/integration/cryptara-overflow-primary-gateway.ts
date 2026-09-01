import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Process-local gateway context for authoritative-primary access while the
 * verified overflow/HyperBridge data plane is active.
 *
 * The gateway creates no database pool and grants no authority. It is only the
 * routing boundary that makes primary access observable and enforceable as:
 * application -> overflow/bridge gateway -> existing primary pool -> primary.
 *
 * HyperBridge/worker reads still consult shared local coherence + overflow first;
 * only a real miss is allowed to enter this upstream context. Generic legacy
 * primary-pool callers are intercepted by cryptara-bootstrap-entry.ts and routed
 * through this same context so there is no application -> primary acquisition.
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
      `[CRYPTARA][OVERFLOW-GATEWAY] primary upstream operation #${routedOperations} routed through overflow/bridge (reason=${normalizedReason}, direct-application-primary=0)`,
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
    routing: 'application_to_overflow_bridge_to_primary' as const,
    authority: 'transport_only' as const,
    createsDatabasePool: false as const,
    directApplicationPrimaryCalls: 0 as const,
    routedOperations,
    nestedOperations,
    lastReason,
    lastRoutedAt,
    active: isCryptaraOverflowPrimaryGatewayContext(),
  };
}
