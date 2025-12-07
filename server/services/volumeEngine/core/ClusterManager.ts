import { Cluster } from 'puppeteer-cluster';
import type * as PuppeteerType from 'puppeteer';
import puppeteer from 'puppeteer';
import { proxyChainManager } from '../stealth/ProxyChainManager';

interface ClusterConfig {
  maxConcurrency?: number;
  timeout?: number;
  retryLimit?: number;
  sameDomainDelay?: number;
}

export class ClusterManager {
  private cluster?: Cluster;
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

    // Initialize proxy chain for stealth
    await proxyChainManager.initialize();
    const stealthProxyUrl = await proxyChainManager.getStealthProxyUrl();

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
          `--proxy-server=${stealthProxyUrl}`, // Dynamic stealth proxy
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      },
      puppeteer: puppeteer as unknown as PuppeteerType.PuppeteerNode,
    });

    console.log('[ClusterManager] Cluster initialized with stealth proxy');
  }

  async execute<T>(data: any, task: ({ page, data }: { page: any; data: any }) => Promise<T>): Promise<T> {
    if (!this.cluster) {
      await this.initialize();
    }

    return await this.cluster!.execute(data, task);
  }

  async queue<T>(data: any, task: ({ page, data }: { page: any; data: any }) => Promise<T>): Promise<void> {
    if (!this.cluster) {
      await this.initialize();
    }

    await this.cluster!.queue(data, task);
  }

  async close() {
    if (this.cluster) {
      await this.cluster.close();
      console.log('[ClusterManager] Cluster closed');
    }
    
    await proxyChainManager.close();
  }

  async idle() {
    if (this.cluster) {
      await this.cluster.idle();
    }
  }

  getStats() {
    return {
      maxConcurrency: this.config.maxConcurrency,
      timeout: this.config.timeout,
      retryLimit: this.config.retryLimit,
      sameDomainDelay: this.config.sameDomainDelay,
    };
  }
}

export const clusterManager = new ClusterManager();
