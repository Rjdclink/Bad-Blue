import type { SupportedChain } from '../core/zero-capital-engine.js';
import {
  loadConfiguredZeroCapitalRoutes,
  type ConfiguredZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  ensureUniversalReverseRoutes,
  reverseRouteCoverage,
} from '../execution/adapters/zero-capital-route-direction.js';
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
  reverseTemplatesAdded: number;
  compatibleReverseCoverage: ReturnType<typeof reverseRouteCoverage>;
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
 * deduplicated by exact route identity. Every closed-cycle route whose adapters are
 * bidirectionally executable also receives a structural reverse twin when one is not
 * already represented. This expansion performs no quote/RPC work.
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
  const baseRoutes = [...byId.values()];
  const routes = ensureUniversalReverseRoutes(baseRoutes);

  return {
    routes,
    explicitRoutes: explicit.length,
    dynamicRoutes: dynamic.length,
    graphlessRoutes: graphless.length,
    reverseTemplatesAdded: routes.length - baseRoutes.length,
    compatibleReverseCoverage: reverseRouteCoverage(routes),
    chains: [...new Set(routes.map(route => route.chain as SupportedChain))],
  };
}

export function getCanonicalZeroCapitalRoutes(input: Parameters<typeof getCanonicalZeroCapitalRouteSnapshot>[0] = {}): ConfiguredZeroCapitalRoute[] {
  return getCanonicalZeroCapitalRouteSnapshot(input).routes;
}
