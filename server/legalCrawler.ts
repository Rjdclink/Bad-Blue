/**
 * Legal Crawler System
 * 
 * Comprehensive crawler for legal databases that:
 * - Scans legal databases (Clio, LexisNexis, MyCase interfaces)
 * - Retrieves open-source case law
 * - Monitors regulatory and statute updates
 * - Automatically processes, filters, and stores in domain knowledge bases
 * - Indexes for instant AI sub-agent retrieval
 */

import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { unifiedSearch } from './webSearchService';

// Import orchestrator for synchronization
import { synchronizeCrawlerUpdate, type CrawlerUpdate } from './fourJIOrchestrator';

const DOMAINS_DIR = path.join(process.cwd(), 'domains');
const CRAWLER_STATE_FILE = path.join(process.cwd(), 'data', 'crawler_state.json');
// CRAWLER_QUEUE_FILE reserved for future queue persistence feature
// const CRAWLER_QUEUE_FILE = path.join(process.cwd(), 'data', 'crawler_queue.json');

export const crawlerEvents = new EventEmitter();

/**
 * Crawler configuration
 */
export interface CrawlerConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  maxRetries: number;
  sources: CrawlerSource[];
}

export interface CrawlerSource {
  id: string;
  name: string;
  type: 'case_law' | 'statutes' | 'regulations' | 'templates' | 'news';
  url: string;
  enabled: boolean;
  domains: string[]; // Which domains this source applies to
  lastCrawl?: string;
  crawlFrequency: 'hourly' | 'daily' | 'weekly';
}

export interface CrawlerState {
  isRunning: boolean;
  lastRun: string | null;
  totalCrawled: number;
  totalUpdates: number;
  errors: number;
  queueLength: number;
  sourceStats: Record<string, { success: number; failed: number; lastRun: string }>;
}

export interface CrawledItem {
  id: string;
  sourceId: string;
  type: 'case' | 'statute' | 'regulation' | 'template' | 'news';
  domain: string;
  title: string;
  content: string;
  citation?: string;
  date: string;
  relevance: number;
  metadata: Record<string, any>;
}

// Default crawler configuration
const defaultConfig: CrawlerConfig = {
  enabled: true,
  intervalMs: 3600000, // 1 hour
  batchSize: 50,
  maxRetries: 3,
  sources: [
    {
      id: 'courtlistener',
      name: 'CourtListener Open Case Law',
      type: 'case_law',
      url: 'https://www.courtlistener.com/api/rest/v3/',
      enabled: true,
      domains: ['*'], // All domains
      crawlFrequency: 'daily'
    },
    {
      id: 'uscode',
      name: 'US Code (Congress.gov)',
      type: 'statutes',
      url: 'https://uscode.house.gov/',
      enabled: true,
      domains: ['*'],
      crawlFrequency: 'weekly'
    },
    {
      id: 'ecfr',
      name: 'Electronic Code of Federal Regulations',
      type: 'regulations',
      url: 'https://www.ecfr.gov/',
      enabled: true,
      domains: ['administrative-law', 'environmental-law', 'tax-law', 'employment-labor-law'],
      crawlFrequency: 'daily'
    },
    {
      id: 'openstates',
      name: 'Open States Legislation',
      type: 'statutes',
      url: 'https://openstates.org/',
      enabled: true,
      domains: ['*'],
      crawlFrequency: 'daily'
    },
    {
      id: 'justia',
      name: 'Justia Case Law',
      type: 'case_law',
      url: 'https://law.justia.com/',
      enabled: true,
      domains: ['*'],
      crawlFrequency: 'daily'
    }
  ]
};

let crawlerConfig: CrawlerConfig = { ...defaultConfig };
let crawlerState: CrawlerState = {
  isRunning: false,
  lastRun: null,
  totalCrawled: 0,
  totalUpdates: 0,
  errors: 0,
  queueLength: 0,
  sourceStats: {}
};

let crawlerInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the crawler system
 */
export async function initializeCrawler(config?: Partial<CrawlerConfig>): Promise<void> {
  console.log('[Legal Crawler] Initializing...');
  
  if (config) {
    crawlerConfig = { ...crawlerConfig, ...config };
  }
  
  // Load existing state
  await loadCrawlerState();
  
  console.log(`[Legal Crawler] Configured with ${crawlerConfig.sources.length} sources`);
  
  if (crawlerConfig.enabled) {
    scheduleCrawler();
  }
  
  crawlerEvents.emit('initialized', { config: crawlerConfig, state: crawlerState });
}

/**
 * Schedule periodic crawling
 */
function scheduleCrawler(): void {
  if (crawlerInterval) {
    clearInterval(crawlerInterval);
  }
  
  console.log(`[Legal Crawler] Scheduling crawls every ${crawlerConfig.intervalMs / 1000 / 60} minutes`);
  
  crawlerInterval = setInterval(async () => {
    await runCrawlCycle();
  }, crawlerConfig.intervalMs);
  
  // Run initial crawl after short delay
  setTimeout(async () => {
    await runCrawlCycle();
  }, 10000);
}

/**
 * Run a complete crawl cycle
 */
export async function runCrawlCycle(): Promise<{
  sourcesProcessed: number;
  itemsCrawled: number;
  updatesApplied: number;
  errors: number;
}> {
  if (crawlerState.isRunning) {
    console.log('[Legal Crawler] Crawl already in progress, skipping...');
    return { sourcesProcessed: 0, itemsCrawled: 0, updatesApplied: 0, errors: 0 };
  }
  
  console.log('[Legal Crawler] Starting crawl cycle...');
  crawlerState.isRunning = true;
  crawlerState.lastRun = new Date().toISOString();
  
  let sourcesProcessed = 0;
  let itemsCrawled = 0;
  let updatesApplied = 0;
  let errors = 0;
  
  crawlerEvents.emit('crawl_started', { timestamp: crawlerState.lastRun });
  
  for (const source of crawlerConfig.sources) {
    if (!source.enabled) continue;
    
    // Check if source needs crawling based on frequency
    if (!shouldCrawlSource(source)) {
      continue;
    }
    
    try {
      console.log(`[Legal Crawler] Processing source: ${source.name}`);
      
      const items = await crawlSource(source);
      sourcesProcessed++;
      itemsCrawled += items.length;
      
      // Process items and update knowledge bases
      const updates = await processAndStoreItems(items, source);
      updatesApplied += updates;
      
      // Update source stats
      crawlerState.sourceStats[source.id] = {
        success: (crawlerState.sourceStats[source.id]?.success || 0) + 1,
        failed: crawlerState.sourceStats[source.id]?.failed || 0,
        lastRun: new Date().toISOString()
      };
      
      source.lastCrawl = new Date().toISOString();
      
    } catch (error: any) {
      console.error(`[Legal Crawler] Error crawling ${source.name}:`, error.message);
      errors++;
      crawlerState.errors++;
      
      crawlerState.sourceStats[source.id] = {
        success: crawlerState.sourceStats[source.id]?.success || 0,
        failed: (crawlerState.sourceStats[source.id]?.failed || 0) + 1,
        lastRun: new Date().toISOString()
      };
    }
  }
  
  crawlerState.isRunning = false;
  crawlerState.totalCrawled += itemsCrawled;
  crawlerState.totalUpdates += updatesApplied;
  
  await saveCrawlerState();
  
  const result = { sourcesProcessed, itemsCrawled, updatesApplied, errors };
  console.log(`[Legal Crawler] Crawl cycle complete:`, result);
  
  crawlerEvents.emit('crawl_complete', result);
  
  return result;
}

/**
 * Check if source should be crawled based on frequency
 */
function shouldCrawlSource(source: CrawlerSource): boolean {
  if (!source.lastCrawl) return true;
  
  const lastCrawl = new Date(source.lastCrawl);
  const now = new Date();
  const hoursSinceLastCrawl = (now.getTime() - lastCrawl.getTime()) / (1000 * 60 * 60);
  
  switch (source.crawlFrequency) {
    case 'hourly':
      return hoursSinceLastCrawl >= 1;
    case 'daily':
      return hoursSinceLastCrawl >= 24;
    case 'weekly':
      return hoursSinceLastCrawl >= 168;
    default:
      return true;
  }
}

/**
 * Crawl a specific source
 */
async function crawlSource(source: CrawlerSource): Promise<CrawledItem[]> {
  const items: CrawledItem[] = [];
  
  switch (source.type) {
    case 'case_law':
      items.push(...await crawlCaseLaw(source));
      break;
    case 'statutes':
      items.push(...await crawlStatutes(source));
      break;
    case 'regulations':
      items.push(...await crawlRegulations(source));
      break;
    case 'templates':
      items.push(...await crawlTemplates(source));
      break;
    case 'news':
      items.push(...await crawlLegalNews(source));
      break;
  }
  
  return items;
}

/**
 * Query the configured public source and return only records actually surfaced
 * by retrieval. No citations, courts, statutes, or dates are synthesized.
 */
async function crawlPublicSource(
  source: CrawlerSource,
  itemType: CrawledItem['type'],
  topicLabel: string,
  maxDomains: number
): Promise<CrawledItem[]> {
  const domains = source.domains.includes('*')
    ? await getAvailableDomains()
    : source.domains;
  const selectedDomains = domains.slice(0, maxDomains);
  const sourceHost = (() => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  const items: CrawledItem[] = [];
  const seenUrls = new Set<string>();

  for (const domain of selectedDomains) {
    const domainLabel = domain.replace(/-/g, ' ');
    const siteFilter = sourceHost ? `site:${sourceHost}` : '';
    const query = `${siteFilter} "${domainLabel}" ${topicLabel}`.trim();

    let results: Array<{ title?: string; url: string; snippet?: string }> = [];
    try {
      results = await unifiedSearch(query, {
        limit: Math.max(3, Math.min(10, crawlerConfig.batchSize)),
      });
    } catch (error) {
      console.warn(`[Legal Crawler] Public retrieval failed for ${source.name} / ${domain}:`, error);
      continue;
    }

    for (const result of results) {
      if (!result?.url || seenUrls.has(result.url)) continue;

      let resultHost = '';
      try {
        resultHost = new URL(result.url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (
        sourceHost &&
        resultHost !== sourceHost &&
        !resultHost.endsWith(`.${sourceHost}`) &&
        !sourceHost.endsWith(`.${resultHost}`)
      ) {
        continue;
      }

      seenUrls.add(result.url);
      const title = (result.title || result.url).trim();
      const content = (result.snippet || '').trim();
      const citation =
        [title, content].join(' ').match(
          /\b(?:\d+\s+U\.S\.C\.\s*§+\s*[\w.-]+|\d+\s+C\.F\.R\.\s*§+\s*[\w.-]+|\d+\s+F\.?\s*(?:2d|3d|4th)?\s+\d+)\b/i
        )?.[0];

      items.push({
        id: createHash('sha256').update(`${source.id}|${domain}|${result.url}`).digest('hex').slice(0, 24),
        sourceId: source.id,
        type: itemType,
        domain,
        title,
        content,
        citation,
        date: new Date().toISOString(),
        relevance: content ? 0.8 : 0.6,
        metadata: {
          source: source.name,
          sourceUrl: result.url,
          retrievedAt: new Date().toISOString(),
        },
      });

      if (items.length >= crawlerConfig.batchSize) return items;
    }
  }

  return items;
}

/**
 * Crawl case law from source
 */
async function crawlCaseLaw(source: CrawlerSource): Promise<CrawledItem[]> {
  return crawlPublicSource(source, 'case', 'case opinion decision', 5);
}

/**
 * Crawl statutes from source
 */
async function crawlStatutes(source: CrawlerSource): Promise<CrawledItem[]> {
  return crawlPublicSource(source, 'statute', 'statute code law', 3);
}

/**
 * Crawl regulations from source
 */
async function crawlRegulations(source: CrawlerSource): Promise<CrawledItem[]> {
  return crawlPublicSource(source, 'regulation', 'regulation rule CFR', 4);
}

/**
 * Crawl legal templates from source
 */
async function crawlTemplates(source: CrawlerSource): Promise<CrawledItem[]> {
  return crawlPublicSource(source, 'template', 'official form template', 3);
}

/**
 * Crawl legal news from source
 */
async function crawlLegalNews(source: CrawlerSource): Promise<CrawledItem[]> {
  return crawlPublicSource(source, 'news', 'legal update news', 2);
}

/**
 * Process crawled items and store in appropriate knowledge bases
 */
async function processAndStoreItems(
  items: CrawledItem[],
  source: CrawlerSource
): Promise<number> {
  let updatesApplied = 0;
  
  // Group items by domain
  const itemsByDomain = new Map<string, CrawledItem[]>();
  
  for (const item of items) {
    if (!itemsByDomain.has(item.domain)) {
      itemsByDomain.set(item.domain, []);
    }
    itemsByDomain.get(item.domain)!.push(item);
  }
  
  // Update each domain's knowledge base
  for (const [domain, domainItems] of itemsByDomain) {
    try {
      const update = convertToCrawlerUpdate(domain, domainItems);
      await synchronizeCrawlerUpdate(update);
      updatesApplied++;
    } catch (error: any) {
      console.error(`[Legal Crawler] Failed to update ${domain}:`, error.message);
    }
  }
  
  return updatesApplied;
}

/**
 * Convert crawled items to CrawlerUpdate format
 */
function convertToCrawlerUpdate(domain: string, items: CrawledItem[]): CrawlerUpdate {
  const update: CrawlerUpdate = {
    domainId: domain,
    cases: [],
    statutes: [],
    templates: []
  };
  
  for (const item of items) {
    switch (item.type) {
      case 'case':
        update.cases!.push({
          id: item.id,
          name: item.title,
          citation: item.citation || '',
          summary: item.content,
          relevance: `Relevance: ${item.relevance}, Source: ${item.metadata.source}`
        });
        break;
      case 'statute':
      case 'regulation':
        update.statutes!.push({
          id: item.id,
          name: item.title,
          citation: item.citation || '',
          summary: item.content
        });
        break;
      case 'template':
        update.templates!.push({
          id: item.id,
          name: item.title,
          description: item.content
        });
        break;
    }
  }
  
  return update;
}

/**
 * Get list of available domains
 */
async function getAvailableDomains(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Add a new source to the crawler
 */
export function addCrawlerSource(source: CrawlerSource): void {
  crawlerConfig.sources.push(source);
  console.log(`[Legal Crawler] Added source: ${source.name}`);
}

/**
 * Remove a source from the crawler
 */
export function removeCrawlerSource(sourceId: string): boolean {
  const index = crawlerConfig.sources.findIndex(s => s.id === sourceId);
  if (index !== -1) {
    crawlerConfig.sources.splice(index, 1);
    console.log(`[Legal Crawler] Removed source: ${sourceId}`);
    return true;
  }
  return false;
}

/**
 * Enable/disable the crawler
 */
export function setCrawlerEnabled(enabled: boolean): void {
  crawlerConfig.enabled = enabled;
  
  if (enabled) {
    scheduleCrawler();
  } else if (crawlerInterval) {
    clearInterval(crawlerInterval);
    crawlerInterval = null;
  }
  
  console.log(`[Legal Crawler] ${enabled ? 'Enabled' : 'Disabled'}`);
}

/**
 * Get crawler status
 */
export function getCrawlerStatus(): CrawlerState {
  return { ...crawlerState };
}

/**
 * Get crawler configuration
 */
export function getCrawlerConfig(): CrawlerConfig {
  return { ...crawlerConfig };
}

/**
 * Force crawl a specific source
 */
export async function forceCrawlSource(sourceId: string): Promise<{
  itemsCrawled: number;
  updatesApplied: number;
}> {
  const source = crawlerConfig.sources.find(s => s.id === sourceId);
  
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  
  console.log(`[Legal Crawler] Force crawling: ${source.name}`);
  
  const items = await crawlSource(source);
  const updates = await processAndStoreItems(items, source);
  
  source.lastCrawl = new Date().toISOString();
  
  return {
    itemsCrawled: items.length,
    updatesApplied: updates
  };
}

/**
 * Load crawler state from file
 */
async function loadCrawlerState(): Promise<void> {
  try {
    const content = await fs.readFile(CRAWLER_STATE_FILE, 'utf-8');
    crawlerState = { ...crawlerState, ...JSON.parse(content) };
  } catch {
    console.log('[Legal Crawler] No existing state found');
  }
}

/**
 * Save crawler state to file
 */
async function saveCrawlerState(): Promise<void> {
  try {
    const stateDir = path.dirname(CRAWLER_STATE_FILE);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(CRAWLER_STATE_FILE, JSON.stringify(crawlerState, null, 2));
  } catch (error: any) {
    console.error('[Legal Crawler] Failed to save state:', error.message);
  }
}

/**
 * Cleanup on shutdown
 */
export function shutdownCrawler(): void {
  if (crawlerInterval) {
    clearInterval(crawlerInterval);
    crawlerInterval = null;
  }
  console.log('[Legal Crawler] Shutdown complete');
}

export default {
  initializeCrawler,
  runCrawlCycle,
  addCrawlerSource,
  removeCrawlerSource,
  setCrawlerEnabled,
  getCrawlerStatus,
  getCrawlerConfig,
  forceCrawlSource,
  shutdownCrawler,
  crawlerEvents
};
