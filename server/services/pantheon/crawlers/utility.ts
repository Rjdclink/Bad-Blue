import { BaseCrawler } from '../baseCrawler';
import { CrawlerType, type CrawlerTask, type EntropySignature } from '../core';

async function fetchPublicTarget(target: string, timeoutMs: number): Promise<{
  url: string;
  status: number;
  contentType: string;
  content: string;
}> {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported crawler protocol');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
        'User-Agent': 'LegalWhat-PANTHEON/1.0',
      },
    });
    const text = (await response.text()).slice(0, 250_000);
    return {
      url: response.url || url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      content: text,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * FARM: bounded evidence fingerprinting/deduplication. The historical enum
 * description mentioned hash work; this implementation is strictly public-data
 * evidence hashing and never performs password/credential cracking.
 */
export class FarmCrawler extends BaseCrawler {
  private executed = false;

  constructor(task: CrawlerTask) {
    super(task, CrawlerType.FARM);
  }

  async execute(): Promise<EntropySignature[]> {
    if (this.executed) return [];
    this.executed = true;
    const fetched = await fetchPublicTarget(this.task.target, Math.max(1_000, Math.min(this.task.quantum, 8_000)));
    return [this.generateEntropySignature({
      url: fetched.url,
      status: fetched.status,
      contentType: fetched.contentType,
      contentLength: fetched.content.length,
      evidence: fetched.content,
    })];
  }
}

/**
 * PHANTOM: low-overhead public-source observation. It uses ordinary HTTP and
 * does not attempt to evade access controls or detection.
 */
export class PhantomCrawler extends BaseCrawler {
  private executed = false;

  constructor(task: CrawlerTask) {
    super(task, CrawlerType.PHANTOM);
  }

  async execute(): Promise<EntropySignature[]> {
    if (this.executed) return [];
    this.executed = true;
    const fetched = await fetchPublicTarget(this.task.target, Math.max(1_000, Math.min(this.task.quantum, 6_000)));
    return [this.generateEntropySignature(fetched)];
  }
}

/**
 * NOVA: short-lived burst retrieval for latency-sensitive public evidence.
 */
export class NovaCrawler extends BaseCrawler {
  private executed = false;

  constructor(task: CrawlerTask) {
    super(task, CrawlerType.NOVA);
  }

  async execute(): Promise<EntropySignature[]> {
    if (this.executed) return [];
    this.executed = true;
    const fetched = await fetchPublicTarget(this.task.target, Math.max(800, Math.min(this.task.quantum, 4_000)));
    return [this.generateEntropySignature(fetched)];
  }
}
