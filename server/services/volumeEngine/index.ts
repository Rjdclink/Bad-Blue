import { clusterManager } from './core/ClusterManager';
import { smartCache } from './core/SmartCache';

interface VolumeRequest {
  urls: string[];
  useCache?: boolean;
  maxConcurrency?: number;
}

interface VolumeResult {
  url: string;
  content: string;
  fromCache: boolean;
  loadTime: number;
}

export async function scrapeAtVolume(request: VolumeRequest): Promise<VolumeResult[]> {
  const { urls, useCache = true } = request;

  console.log(`[VolumeEngine] Processing ${urls.length} URLs`);

  // Initialize systems
  await smartCache.initialize();
  await clusterManager.initialize();

  const results: VolumeResult[] = [];
  const uncachedUrls: string[] = [];

  // Check cache first
  if (useCache) {
    for (const url of urls) {
      const cached = await smartCache.get(url);
      if (cached) {
        results.push({
          url,
          content: cached,
          fromCache: true,
          loadTime: 0,
        });
      } else {
        uncachedUrls.push(url);
      }
    }
  } else {
    uncachedUrls.push(...urls);
  }

  console.log(`[VolumeEngine] Cache: ${results.length} hits, ${uncachedUrls.length} misses`);

  if (uncachedUrls.length === 0) {
    return results;
  }

  // Scrape uncached URLs
  const scrapeResults = await clusterManager.scrapeMany(
    uncachedUrls.map(url => ({ url }))
  );

  // Cache results
  for (const result of scrapeResults) {
    if (useCache) {
      await smartCache.set(result.url, result.content, '7d');
    }

    results.push({
      url: result.url,
      content: result.content,
      fromCache: false,
      loadTime: result.loadTime,
    });
  }

  console.log(`[VolumeEngine] Complete: ${results.length} total results`);

  return results;
}

export async function getSystemStats() {
  const clusterStats = clusterManager.getStats();
  const cacheStats = smartCache.getStats();

  return {
    cluster: clusterStats,
    cache: cacheStats,
  };
}

export { clusterManager, smartCache };
export type { VolumeRequest, VolumeResult };
