import { snapshotEngine } from './core/SnapshotEngine';
import { publicRecordScraper } from './scraping/PublicRecordScraper';

interface CrawlRequest {
  url: string;
  detectChanges?: boolean;
  respectRobotsTxt?: boolean;
  maxRetries?: number;
}

interface CrawlResult {
  url: string;
  content: string;
  changed: boolean;
  previousHash?: string;
  newHash: string;
  timestamp: Date;
  metadata: {
    statusCode: number;
    headers: Record<string, string>;
  };
}

export async function crawlAndSnapshot(request: CrawlRequest): Promise<CrawlResult> {
  const { url, detectChanges = true } = request;

  console.log(`[IceEngine] Crawling ${url}...`);
  
  const scraped = await publicRecordScraper.scrape({
    url,
    respectRobotsTxt: request.respectRobotsTxt ?? true,
    maxRetries: request.maxRetries ?? 3,
  });

  let diff;
  if (detectChanges) {
    diff = await snapshotEngine.detectChanges(url, scraped.content);
    
    if (diff.changed) {
      await snapshotEngine.createSnapshot(url, scraped.content, {
        statusCode: scraped.statusCode,
        headers: scraped.headers,
        contentType: scraped.headers['content-type'] || 'text/html',
      });
      console.log(`[IceEngine] Snapshot created (changed: ${diff.changed})`);
    } else {
      console.log(`[IceEngine] No changes detected`);
    }
  } else {
    await snapshotEngine.createSnapshot(url, scraped.content, {
      statusCode: scraped.statusCode,
      headers: scraped.headers,
      contentType: scraped.headers['content-type'] || 'text/html',
    });
    diff = await snapshotEngine.detectChanges(url, scraped.content);
  }

  return {
    url,
    content: scraped.content,
    changed: diff.changed,
    previousHash: diff.previousHash,
    newHash: diff.newHash,
    timestamp: scraped.timestamp,
    metadata: {
      statusCode: scraped.statusCode,
      headers: scraped.headers,
    },
  };
}

export { snapshotEngine, publicRecordScraper };
export type { CrawlRequest, CrawlResult };
