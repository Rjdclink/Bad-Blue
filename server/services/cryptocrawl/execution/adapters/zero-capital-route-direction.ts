import type {
  ConfiguredRouteLeg,
  ConfiguredZeroCapitalRoute,
} from './onchain-route-quoter.js';

const REVERSIBLE_PROTOCOLS = new Set([
  'uniswapV3',
  'sushiswap',
  'sushiswapV3',
  'pancakeswapV2',
  'traderJoeV1',
  'fluidDexT1',
]);

function legDirectionKey(leg: ConfiguredRouteLeg): string {
  return [
    leg.tokenIn.toLowerCase(),
    leg.tokenOut.toLowerCase(),
    leg.protocol,
    leg.pool?.toLowerCase() ?? '',
    leg.feeTier ?? '',
    leg.fee ?? '',
  ].join('@');
}

function routeStructuralKey(route: ConfiguredZeroCapitalRoute): string {
  return [
    route.chain,
    route.inputToken.toLowerCase(),
    route.amountIn,
    ...route.legs.map(legDirectionKey),
  ].join('|');
}

export function configuredRouteDirectionKey(route: ConfiguredZeroCapitalRoute): string {
  return route.legs.map(legDirectionKey).join('|');
}

function closedCycle(route: ConfiguredZeroCapitalRoute): boolean {
  if (route.legs.length < 2) return false;
  const first = route.legs[0];
  const last = route.legs[route.legs.length - 1];
  if (first.tokenIn.toLowerCase() !== route.inputToken.toLowerCase()) return false;
  if (last.tokenOut.toLowerCase() !== route.inputToken.toLowerCase()) return false;
  for (let index = 1; index < route.legs.length; index += 1) {
    if (route.legs[index - 1].tokenOut.toLowerCase() !== route.legs[index].tokenIn.toLowerCase()) return false;
  }
  return true;
}

function reverseCompatible(route: ConfiguredZeroCapitalRoute): boolean {
  return closedCycle(route) && route.legs.every(leg => REVERSIBLE_PROTOCOLS.has(leg.protocol));
}

export function reverseConfiguredZeroCapitalRoute(
  route: ConfiguredZeroCapitalRoute,
): ConfiguredZeroCapitalRoute | null {
  if (!reverseCompatible(route)) return null;
  const legs: ConfiguredRouteLeg[] = [...route.legs].reverse().map(leg => ({
    ...leg,
    tokenIn: leg.tokenOut,
    tokenOut: leg.tokenIn,
  }));
  return {
    ...route,
    id: `${route.id}__reverse`,
    legs,
  };
}

/**
 * Adds only structurally missing, capability-compatible reverse routes and keeps each
 * existing/generated twin adjacent to its forward route. Existing reverse variants win
 * by signature, so route universes that already enumerate both orientations do not grow.
 * The operation is structural only: no quote/RPC work is created and downstream bounded
 * route frontiers can inspect a reverse twin without increasing their configured width.
 */
export function ensureUniversalReverseRoutes(
  routes: readonly ConfiguredZeroCapitalRoute[],
): ConfiguredZeroCapitalRoute[] {
  if (routes.length === 0) return [];
  const existingByKey = new Map(routes.map(route => [routeStructuralKey(route), route]));
  const emitted = new Set<string>();
  const output: ConfiguredZeroCapitalRoute[] = [];

  for (const route of routes) {
    const routeKey = routeStructuralKey(route);
    if (emitted.has(routeKey)) continue;
    output.push(route);
    emitted.add(routeKey);

    const reverse = reverseConfiguredZeroCapitalRoute(route);
    if (!reverse) continue;
    const reverseKey = routeStructuralKey(reverse);
    if (emitted.has(reverseKey)) continue;
    const existingReverse = existingByKey.get(reverseKey);
    output.push(existingReverse ?? reverse);
    emitted.add(reverseKey);
  }

  return output;
}

export function reverseRouteCoverage(routes: readonly ConfiguredZeroCapitalRoute[]) {
  const routeKeys = new Set(routes.map(routeStructuralKey));
  let reversible = 0;
  let covered = 0;
  for (const route of routes) {
    const reverse = reverseConfiguredZeroCapitalRoute(route);
    if (!reverse) continue;
    reversible += 1;
    if (routeKeys.has(routeStructuralKey(reverse))) covered += 1;
  }
  return {
    totalRoutes: routes.length,
    reversibleRoutes: reversible,
    reverseCoveredRoutes: covered,
    fullCompatibleReverseCoverage: reversible === covered,
    reverseTwinsAdjacentForBoundedFrontier: true,
    quoteBudgetExpandedByReversePairing: false,
  };
}
