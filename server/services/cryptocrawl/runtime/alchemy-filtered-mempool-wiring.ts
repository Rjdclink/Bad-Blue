import logger from '../../../logger.js';
import { ensureProviderMeshPendingStream } from '../capital-free/provider-mesh-pending-stream.js';

let installed = false;

/**
 * @deprecated Compatibility installer. The former Alchemy-specific monkey patch
 * has been retired; canonical runtime owns the provider-mesh stream directly.
 */
export function ensureAlchemyFilteredMempoolWiring(): void {
  if (installed) return;
  installed = true;
  ensureProviderMeshPendingStream();
  logger.info('[ProviderMeshCompatibility] Legacy filtered-mempool installer delegated to canonical provider mesh', {
    component: 'ProviderMeshCompatibility',
    providerAuthority: 'provider_mesh',
    runtimeMethodMutation: false,
    paidProviderRequired: false,
    alchemyDependency: false,
    executionAuthority: false,
  });
}
