import logger from '../../../logger.js';
import { ensureDynamicRpcProviderWiring } from './dynamic-rpc-provider-wiring.js';

let installed = false;

/**
 * @deprecated Compatibility installer. Token metadata and known-token balance reads
 * are now provider-mesh native in the legacy integration facade itself, so runtime
 * monkey-patching and enhanced-API fallback are intentionally removed.
 */
export function ensureAlchemyStandardRpcFirstWiring(): void {
  if (installed) return;
  installed = true;
  void ensureDynamicRpcProviderWiring();
  logger.info('[ProviderMeshCompatibility] Legacy token-read wiring delegated to canonical provider mesh', {
    component: 'ProviderMeshCompatibility',
    standardRpcAuthority: 'multiProviderRpcManager',
    runtimeMethodMutation: false,
    enhancedApiFallback: false,
    paidProviderRequired: false,
    alchemyDependency: false,
  });
}
