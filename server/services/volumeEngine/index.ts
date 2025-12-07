import { proxyChainManager } from './stealth/ProxyChainManager';
import { apifyIntegration } from './stealth/ApifyIntegration';
import { clusterManager } from './core/ClusterManager';
import { smartCache } from './core/SmartCache';

export async function getSystemStats() {
  const clusterStats = clusterManager.getStats();
  const cacheStats = smartCache.getStats();
  const proxyStats = proxyChainManager.getStats();

  return {
    cluster: clusterStats,
    cache: cacheStats,
    proxy: proxyStats,
  };
}

export { 
  proxyChainManager, 
  apifyIntegration, 
  clusterManager, 
  smartCache 
};
