import { Cluster } from 'puppeteer-cluster';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

interface ClusterConfig {
  maxConcurrency?: number;
  timeout?: number;
  retryLimit?: number;
  sameDomainDelay?: number;
}

interface ScrapeTask {
  url: string;
  options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
  };
}

interface ScrapeResult {
  url: string;
  content: string;
  statusCode: number;
  timestamp: Date;
  loadTime: number;
}

export class ClusterManager {
  private cluster: Cluster | null = null;
  private config: ClusterConfig;

  constructor(config: ClusterConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency || 10,
      timeout: config.timeout || 30000,
      retryLimit: config.retryLimit || 3,
      sameDomainDelay: config.sameDomainDelay || 1000,
    };
  }

  async initialize() {
    if (this.cluster) return;

    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: this.config.maxConcurrency,
      timeout: this.config.timeout,
      retryLimit: this.config.retryLimit,
      sameDomainDelay: this.config.sameDomainDelay,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      },
      puppeteer: puppeteer as any,
    });

    await this.cluster.task(async ({ page, data }: { page: any; data: ScrapeTask }) => {
      const startTime = Date.now();
      
      const response = await page.goto(data.url, {
        waitUntil: data.options?.waitUntil || 'networkidle2',
        timeout: data.options?.timeout || this.config.timeout,
      });

      const content = await page.content();
      const loadTime = Date.now() - startTime;

      return {
        url: data.url,
        content,
        statusCode: response?.status() || 200,
        timestamp: new Date(),
        loadTime,
      };
    });

    console.log(`[ClusterManager] Initialized with ${this.config.maxConcurrency} workers`);
  }

  async scrape(task: ScrapeTask): Promise<ScrapeResult> {
    if (!this.cluster) await this.initialize();
    return this.cluster!.execute(task);
  }

  async scrapeMany(tasks: ScrapeTask[]): Promise<ScrapeResult[]> {
    if (!this.cluster) await this.initialize();

    const promises = tasks.map(task => this.cluster!.execute(task));
    const results = await Promise.all(promises);
    
    return results;
  }

  async close() {
    if (this.cluster) {
      await this.cluster.close();
      this.cluster = null;
      console.log('[ClusterManager] Cluster closed');
    }
  }

  getStats() {
    return {
      maxConcurrency: this.config.maxConcurrency,
      timeout: this.config.timeout,
      retryLimit: this.config.retryLimit,
    };
  }
}

export const clusterManager = new ClusterManager();
