import { createHash } from 'node:crypto';
import { BaseCrawler } from '../baseCrawler';
import {
  attachCrawlerCapabilityOutput,
  CrawlerType,
  requireVerifiedCrawlerSourceSnapshot,
  type CrawlerSourceSnapshot,
  type CrawlerTask,
  type EntropySignature,
} from '../core';

abstract class SingleSnapshotCrawler extends BaseCrawler {
  private executed = false;

  protected claimSnapshot(): Readonly<CrawlerSourceSnapshot> | undefined {
    const snapshot = requireVerifiedCrawlerSourceSnapshot(this.task);
    if (this.executed) return undefined;
    this.executed = true;
    return snapshot;
  }

  protected signature(
    snapshot: Readonly<CrawlerSourceSnapshot>,
    output: Readonly<Record<string, unknown>>,
  ): EntropySignature {
    return attachCrawlerCapabilityOutput(this.generateEntropySignature(output), snapshot, output);
  }
}

/** FARM: deterministic evidence fingerprinting and deduplication metadata. */
export class FarmCrawler extends SingleSnapshotCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.FARM);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = this.claimSnapshot();
    if (!snapshot) return [];
    const output = Object.freeze({
      function: 'snapshot-evidence-fingerprinting',
      algorithm: 'sha256',
      digest: createHash('sha256').update(snapshot.content).digest('hex'),
      contentLength: snapshot.content.length,
      contentType: snapshot.contentType,
    });
    return [this.signature(snapshot, output)];
  }
}

/** PHANTOM: passive structural observation without access-control evasion. */
export class PhantomCrawler extends SingleSnapshotCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.PHANTOM);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = this.claimSnapshot();
    if (!snapshot) return [];
    const content = snapshot.content;
    const output = Object.freeze({
      function: 'snapshot-structural-observation',
      contentLength: content.length,
      lineCount: content.split(/\r?\n/).length,
      linkCount: (content.match(/<a\b/gi) || []).length,
      scriptCount: (content.match(/<script\b/gi) || []).length,
      tableCount: (content.match(/<table\b/gi) || []).length,
      formCount: (content.match(/<form\b/gi) || []).length,
      requestsPerformed: 0,
    });
    return [this.signature(snapshot, output)];
  }
}

/** NOVA: bounded salient-term extraction for latency-sensitive analysis. */
export class NovaCrawler extends SingleSnapshotCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.NOVA);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = this.claimSnapshot();
    if (!snapshot) return [];
    const text = snapshot.content
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100_000);
    const frequencies = new Map<string, number>();
    for (const token of text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || []) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
    const salientTerms = [...frequencies.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([term, count]) => ({ term, count }));
    const output = Object.freeze({
      function: 'snapshot-salient-term-extraction',
      analyzedCharacters: text.length,
      uniqueTerms: frequencies.size,
      salientTerms,
      requestsPerformed: 0,
    });
    return [this.signature(snapshot, output)];
  }
}
