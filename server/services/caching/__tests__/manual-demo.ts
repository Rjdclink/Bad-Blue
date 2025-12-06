/**
 * Manual demonstration of the caching system
 * Run with: tsx server/services/caching/__tests__/manual-demo.ts
 */

import { cacheManager } from '../CacheManager';

console.log('='.repeat(60));
console.log('Intelligent Caching System - Manual Demo');
console.log('='.repeat(60));
console.log();

// Demo 1: Basic caching
console.log('📦 Demo 1: Basic Caching Operations');
console.log('-'.repeat(60));

const cache = cacheManager.getCache<string>('demo-cache', {
  ttl: 5000, // 5 seconds
  maxEntries: 10
});

cache.set('user:1', 'John Doe');
cache.set('user:2', 'Jane Smith');

console.log('✓ Set user:1 =', cache.get('user:1'));
console.log('✓ Set user:2 =', cache.get('user:2'));
console.log('✗ Get user:3 (not exist) =', cache.get('user:3'));
console.log();

// Demo 2: Stats tracking
console.log('📊 Demo 2: Statistics Tracking');
console.log('-'.repeat(60));

// Create some hits and misses
cache.get('user:1'); // hit
cache.get('user:1'); // hit
cache.get('user:3'); // miss
cache.get('user:4'); // miss

const stats = cache.getStats();
console.log('Cache Statistics:');
console.log(`  Hits: ${stats.hits}`);
console.log(`  Misses: ${stats.misses}`);
console.log(`  Evictions: ${stats.evictions}`);
console.log(`  Size: ${stats.size} bytes`);
console.log(`  Max Size: ${stats.maxSize} bytes`);
console.log(`  Hit Rate: ${(stats.hits / (stats.hits + stats.misses) * 100).toFixed(2)}%`);
console.log();

// Demo 3: LRU Eviction
console.log('🗑️  Demo 3: LRU Eviction');
console.log('-'.repeat(60));

const lruCache = cacheManager.getCache<number>('lru-demo', {
  maxEntries: 3
});

console.log('Adding 4 entries to cache with maxEntries=3...');
lruCache.set('item1', 100);
lruCache.set('item2', 200);
lruCache.set('item3', 300);

// Access item1 to make it recently used
lruCache.get('item1');
console.log('✓ Accessed item1 to make it recently used');

// Add item4, should evict item2 (least recently used)
lruCache.set('item4', 400);

console.log('✓ Added item4');
console.log(`  item1 exists: ${lruCache.has('item1')} (should be true - recently accessed)`);
console.log(`  item2 exists: ${lruCache.has('item2')} (should be false - evicted)`);
console.log(`  item3 exists: ${lruCache.has('item3')} (should be true)`);
console.log(`  item4 exists: ${lruCache.has('item4')} (should be true - just added)`);

const lruStats = lruCache.getStats();
console.log(`  Evictions: ${lruStats.evictions}`);
console.log();

// Demo 4: TTL Expiration
console.log('⏰ Demo 4: TTL Expiration');
console.log('-'.repeat(60));

const ttlCache = cacheManager.getCache<string>('ttl-demo', {
  ttl: 1000 // 1 second
});

ttlCache.set('temporary', 'This will expire');
console.log('✓ Set temporary value with 1 second TTL');
console.log(`  Value: ${ttlCache.get('temporary')}`);

console.log('⏳ Waiting 1.5 seconds for expiration...');

setTimeout(() => {
  console.log(`  Value after expiration: ${ttlCache.get('temporary') || 'undefined (expired)'}`);
  console.log();
  
  // Demo 5: Multiple caches
  console.log('🎯 Demo 5: Multiple Named Caches');
  console.log('-'.repeat(60));
  
  const userCache = cacheManager.getCache<object>('users');
  const productCache = cacheManager.getCache<object>('products');
  
  userCache.set('admin', { name: 'Admin', role: 'admin' });
  productCache.set('laptop', { name: 'Laptop', price: 999 });
  
  console.log('✓ Created separate caches for users and products');
  
  const allStats = cacheManager.getStats();
  console.log('All cache statistics:');
  Object.keys(allStats).forEach(name => {
    const s = allStats[name];
    console.log(`  ${name}: ${s.hits} hits, ${s.misses} misses`);
  });
  console.log();
  
  // Final summary
  console.log('='.repeat(60));
  console.log('✅ Demo Complete!');
  console.log('='.repeat(60));
  console.log();
  console.log('Key Features Demonstrated:');
  console.log('  ✓ Basic set/get operations');
  console.log('  ✓ Hit/miss tracking');
  console.log('  ✓ LRU eviction policy');
  console.log('  ✓ TTL-based expiration');
  console.log('  ✓ Multiple named caches');
  console.log('  ✓ Statistics aggregation');
  console.log();
  console.log('For Shadow Retrieval integration, see:');
  console.log('  server/services/shadowRetrieval/index.ts');
  console.log();
}, 1500);
