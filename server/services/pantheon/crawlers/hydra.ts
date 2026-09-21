import { BaseCrawler } from '../baseCrawler';
import {
  attachCrawlerCapabilityOutput,
  CrawlerType,
  requireVerifiedCrawlerSourceSnapshot,
  type CrawlerTask,
  type EntropySignature,
  type ExplorationResult,
} from '../core';

/**
 * HYDRA: multi-branch discovery over one verified canonical source snapshot.
 * It enumerates and prioritizes links found in that snapshot but never follows
 * them; discovered URLs return to the category controller as candidates.
 */
export class HydraCrawler extends BaseCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.HYDRA);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = requireVerifiedCrawlerSourceSnapshot(this.task);
    const links = extractSnapshotLinks(snapshot.content, snapshot.sourceUrl);
    const richness = assessSnapshotRichness(snapshot.content);
    const result: ExplorationResult = {
      target: snapshot.sourceUrl,
      richness,
      nextTarget: links[0] || '',
      links: links.slice(0, 10),
      contentLength: snapshot.content.length,
      discovered: links,
      explored: 1,
      depth: 0,
      branches: links.length,
    };
    const output = Object.freeze({
      function: 'snapshot-link-discovery',
      discoveredCount: links.length,
      prioritizedCandidates: links.slice(0, 10),
      richness,
      followedLinks: 0,
    });
    return [attachCrawlerCapabilityOutput(
      this.generateEntropySignature(result),
      snapshot,
      output,
    )];
  }
}

function extractSnapshotLinks(content: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href=(?:["']([^"']+)["']|([^\s>]{1,2048}))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    try {
      const candidate = new URL(match[1] || match[2], baseUrl);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
        candidate.hash = '';
        links.push(candidate.toString());
      }
    } catch {
      // Invalid references are not discovery candidates.
    }
  }
  return [...new Set(links)].slice(0, 100);
}

function assessSnapshotRichness(content: string): number {
  const hasJson = /{[\s\S]*"[^"]+"\s*:\s*[^}]*}/.test(content);
  const hasTable = /<table/i.test(content);
  const hasForm = /<form/i.test(content);
  const density = Math.min(content.length / 10_000, 1);
  return Math.min(
    (hasJson ? 0.3 : 0) +
    (hasTable ? 0.2 : 0) +
    (hasForm ? 0.2 : 0) +
    density * 0.3,
    1,
  );
}
