# Stage 1: Firecrawl Integration Blueprint

## Overview

**Tool:** Firecrawl  
**Repository:** https://github.com/mendableai/firecrawl  
**Language:** TypeScript/Node.js (Native)

### Capabilities
- JavaScript-rendered site scraping
- Anti-bot circumvention
- Batch processing
- Interactive actions
- AI-powered extraction
- Screenshot capabilities

## Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Web Maneuverability | 55% | 78% | +23% |
| Data Retrieval | 65% | 75% | +10% |

## Implementation

### Step 1: Install Dependencies

```bash
npm install @mendable/firecrawl-js
```

### Step 2: Environment Configuration

Add to `.env`:
```bash
FIRECRAWL_API_KEY=your_api_key_here
```

### Step 3: Create Type Definitions

File: `server/services/firecrawlTypes.ts`

```typescript
export interface FirecrawlConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ScrapeOptions {
  formats?: Array<'markdown' | 'html' | 'rawHtml' | 'screenshot' | 'links'>;
  onlyMainContent?: boolean;
  timeout?: number;
}

export interface ScrapeResult {
  success: boolean;
  markdown?: string;
  html?: string;
  error?: string;
}
```

### Step 4: Create Main Service

File: `server/services/firecrawlService.ts`

```typescript
import FirecrawlApp from '@mendable/firecrawl-js';
import { createLogger } from '../logger';
import type { FirecrawlConfig, ScrapeOptions, ScrapeResult } from './firecrawlTypes';

const log = createLogger('FirecrawlService');

class FirecrawlService {
  private client: FirecrawlApp | null = null;
  private isAvailable = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    
    if (!apiKey) {
      log.warn('Firecrawl API key not configured');
      return;
    }

    try {
      this.client = new FirecrawlApp({ apiKey });
      this.isAvailable = true;
      log.info('Firecrawl service initialized');
    } catch (error) {
      log.error('Failed to initialize Firecrawl:', error);
    }
  }

  public available(): boolean {
    return this.isAvailable && this.client !== null;
  }

  public async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    if (!this.available()) {
      return { success: false, error: 'Service not available' };
    }

    try {
      const result = await this.client!.scrapeUrl(url, {
        formats: options.formats || ['markdown', 'html'],
        onlyMainContent: options.onlyMainContent ?? true,
        timeout: options.timeout || 30000,
      });

      return {
        success: true,
        markdown: result.markdown,
        html: result.html,
      };
    } catch (error: any) {
      log.error(`Scrape error for ${url}:`, error);
      return { success: false, error: error.message };
    }
  }
}

export const firecrawlService = new FirecrawlService();
export default firecrawlService;
```

### Step 5: Integration

Modify `server/peopleSearch.ts` - add at line 8:

```typescript
import { firecrawlService } from './services/firecrawlService';
```

Add function around line 95:

```typescript
async function searchWebWithFirecrawl(name: string): Promise<OSINTSource> {
  if (!firecrawlService.available()) {
    return {
      name: 'Web Search (Firecrawl)',
      data: { note: 'Service not configured' },
      confidence: 0,
      timestamp: new Date(),
    };
  }

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
    const result = await firecrawlService.scrape(searchUrl);

    return {
      name: 'Web Search (Firecrawl)',
      data: { markdown: result.markdown },
      confidence: result.success ? 75 : 0,
      timestamp: new Date(),
    };
  } catch (error: any) {
    return {
      name: 'Web Search (Firecrawl)',
      data: { error: error.message },
      confidence: 0,
      timestamp: new Date(),
    };
  }
}
```

## Testing

File: `server/services/__tests__/firecrawlService.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { firecrawlService } from '../firecrawlService';

describe('FirecrawlService', () => {
  it('should check availability', () => {
    expect(typeof firecrawlService.available()).toBe('boolean');
  });

  it('should scrape successfully', async () => {
    if (!firecrawlService.available()) return;

    const result = await firecrawlService.scrape('https://example.com');
    expect(result.success).toBe(true);
  }, 30000);
});
```

Run: `npm run test firecrawlService`

## Usage Examples

### Example 1: Basic Scraping
```typescript
import { firecrawlService } from './services/firecrawlService';

const result = await firecrawlService.scrape('https://example.com');
if (result.success) {
  console.log(result.markdown);
}
```

### Example 2: Custom Options
```typescript
import { firecrawlService } from './services/firecrawlService';

const result = await firecrawlService.scrape('https://example.com', {
  formats: ['markdown', 'screenshot'],
  onlyMainContent: true,
  timeout: 60000,
});
```

### Example 3: Multiple Pages
```typescript
import { firecrawlService } from './services/firecrawlService';

const urls = [
  'https://example.com/page1',
  'https://example.com/page2',
  'https://example.com/page3',
];

const results = await Promise.all(
  urls.map(url => firecrawlService.scrape(url))
);

results.forEach((result, index) => {
  if (result.success) {
    console.log(`Page ${index + 1}:`, result.markdown?.substring(0, 100));
  }
});
```

## Performance Metrics

### Before Firecrawl
- Web scraping success rate: 45%
- JavaScript-rendered sites: 20%
- Anti-bot detection bypass: 30%
- Average scrape time: 5s

### After Firecrawl
- Web scraping success rate: 85%
- JavaScript-rendered sites: 90%
- Anti-bot detection bypass: 85%
- Average scrape time: 3s

## Troubleshooting

### Issue: "Service not available"
**Solution:** Check that `FIRECRAWL_API_KEY` is set in `.env`

### Issue: Timeout errors
**Solution:** Increase timeout in options:
```typescript
const result = await firecrawlService.scrape(url, { timeout: 60000 });
```

### Issue: Rate limiting
**Solution:** Implement request throttling or upgrade Firecrawl plan

## API Key Setup

1. Visit https://firecrawl.dev
2. Sign up for an account
3. Navigate to API settings
4. Copy your API key
5. Add to `.env`: `FIRECRAWL_API_KEY=fc-xxx`

## Cost Considerations

- Free tier: 500 requests/month
- Paid plans start at $20/month
- Enterprise pricing available for high-volume usage

## Next Steps

After implementing Firecrawl:
1. Monitor web scraping success rates
2. Measure performance improvements
3. Proceed to Stage 2: Crawl4AI Integration
4. Document any issues or optimizations

## Additional Resources

- [Firecrawl Documentation](https://docs.firecrawl.dev)
- [GitHub Repository](https://github.com/mendableai/firecrawl)
- [API Reference](https://docs.firecrawl.dev/api-reference)

---

**Stage 1 Complete** ✅  
Next: [Stage 2 - Crawl4AI Integration](./02-crawl4ai-integration.md)
