# Redis Setup Guide

## Development (Local)

### macOS
```bash
brew install redis
brew services start redis
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

### Windows
Download from https://github.com/microsoftarchive/redis/releases

## Production (Railway)

1. Go to your Railway project dashboard
2. Click "New" → "Database" → "Add Redis"
3. Railway will automatically set REDIS_URL environment variable
4. Redeploy your application

## Verify Installation

```bash
# Test Redis connection
redis-cli ping
# Should return: PONG

# Or use Node.js
node -e "const Redis = require('ioredis'); const r = new Redis(); r.ping().then(console.log);"
```

## Configuration

The cache service automatically falls back to memory-only mode if Redis is unavailable.

### Cache Tiers
- **Hot** (5 min): Memory cache for frequently accessed data
- **Warm** (24 hours): Redis cache for recent searches
- **Cold** (7 days): Redis cache for historical data

## Monitoring

Check cache stats via:
```typescript
import { cacheService } from './server/services/redisCache';
console.log(cacheService.getStats());
```
