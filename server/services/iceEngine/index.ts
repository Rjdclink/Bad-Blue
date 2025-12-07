// EXIF Geolocation Mapper exports
import { exifExtractor, type LocationData, type FileUpload } from './exif/ExifExtractor';
import { leafletMapper } from './exif/LeafletMapper';
import { mapRenderer } from './exif/MapRenderer';
import path from 'path';

// Snapshot Engine exports
import { snapshotEngine } from './core/SnapshotEngine';
import { publicRecordScraper } from './scraping/PublicRecordScraper';

// EXIF Geolocation Mapper interfaces
interface EvidenceMapRequest {
  uploads: FileUpload[];
  caseId: string;
}

interface EvidenceMapResult {
  screenshotPath: string;
  htmlPath: string;
  locationCount: number;
  caseId: string;
}

// Snapshot Engine interfaces
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

// EXIF Geolocation Mapper function
export async function generateEvidenceMap(request: EvidenceMapRequest): Promise<EvidenceMapResult> {
  const { uploads, caseId } = request;

  console.log(`[IceEngine] Extracting EXIF from ${uploads.length} files...`);
  const locations = await exifExtractor.extractBatch(uploads);

  if (locations.length === 0) {
    throw new Error('No GPS data found in uploaded files');
  }

  console.log(`[IceEngine] Found ${locations.length} locations`);

  const outputPath = path.join(process.cwd(), 'evidence-maps');
  const htmlPath = await leafletMapper.generateMapHTML({
    locations,
    caseId,
    outputPath,
  });

  const screenshotPath = await mapRenderer.renderMapScreenshot({
    htmlPath,
    outputPath,
    caseId,
  });

  return {
    screenshotPath,
    htmlPath,
    locationCount: locations.length,
    caseId,
  };
}

// Snapshot Engine function
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
        contentType: scraped.headers || 'text/html',
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

// Export all components
export { exifExtractor, leafletMapper, mapRenderer, snapshotEngine, publicRecordScraper };
export type { FileUpload, LocationData, EvidenceMapRequest, EvidenceMapResult, CrawlRequest, CrawlResult };
