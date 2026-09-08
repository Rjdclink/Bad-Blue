import type { SupportedChain } from '../core/zero-capital-engine.js';
import {
  loadConfiguredZeroCapitalRoutes,
  type ConfiguredZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { supportsSponsoredReceiverChain } from '../execution/adapters/sponsored-receiver-manager.js';
import {
  buildDynamicZeroCapitalRouteTemplates,
  getCachedGraphlessDynamicRouteTemplates,
} from './dynamic-zero-capital-routes.js';

export interface CanonicalZeroCapitalRouteSnapshot {
  routes: ConfiguredZeroCapitalRoute[];
  explicitRoutes: number;
  dynamicRoutes: number;
  graphlessRoutes: number;
  chains: SupportedChain[];
}

function activeChain(raw: string): raw is Exclude<SupportedChain, 'europa'> {
  return raw !== 'europa' && supportsSponsoredReceiverChain(raw as any);
}

/**
 * Sole ZERO_CAPITAL_ATOMIC route-composition authority.
 *
 * Explicit configuration, deterministic dynamic templates, and graphless routes
 * are inputs to this function; no caller is allowed to build a competing merged
 * route set. The returned set is filtered to reviewed receiver-capable chains and
 * deduplicated by exact route identity.
 */
export function getCanonicalZeroCapitalRouteSnapshot(input: {
  providerChains?: Iterable<string>;
  configuredRoutes?: readonly ConfiguredZeroCapitalRoute[];
  includeCachedGraphless?: boolean;
} = {}): CanonicalZeroCapitalRouteSnapshot {
  const explicit = [...(input.configuredRoutes || loadConfiguredZeroCapitalRoutes())]
    .filter(route => activeChain(route.chain));
  const providerChains = [...new Set(
    input.providerChains
      ? [...input.providerChains].filter(activeChain)
      : (['polygon', 'arbitrum'] as const).filter(activeChain),
  )];
  const dynamic = providerChains.flatMap(chain => buildDynamicZeroCapitalRouteTemplates(chain as any))
    .filter(route => activeChain(route.chain));
  const graphless = input.includeCachedGraphless === false
    ? []
    : getCachedGraphlessDynamicRouteTemplates().filter(route => activeChain(route.chain));

  const byId = new Map<string, ConfiguredZeroCapitalRoute>();
  for (const route of [...explicit, ...dynamic, ...graphless]) byId.set(route.id, route);
  const routes = [...byId.values()];

  return {
    routes,
    explicitRoutes: explicit.length,
    dynamicRoutes: dynamic.length,
    graphlessRoutes: graphless.length,
    chains: [...new Set(routes.map(route => route.chain as SupportedChain))],
  };
}

export function getCanonicalZeroCapitalRoutes(input: Parameters<typeof getCanonicalZeroCapitalRouteSnapshot>[0] = {}): ConfiguredZeroCapitalRoute[] {
  return getCanonicalZeroCapitalRouteSnapshot(input).routes;
}
