import { BaseCrawler } from '../baseCrawler';
import {
  attachCrawlerCapabilityOutput,
  CrawlerType,
  requireVerifiedCrawlerSourceSnapshot,
  type CrawlerTask,
  type EntropySignature,
} from '../core';

/**
 * WRAITH: passive asynchronous-structure observation over the already acquired
 * live snapshot. It performs no timing, vulnerability, header, or network
 * probes and makes no claims about data absent from the snapshot.
 */
export class WraithCrawler extends BaseCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.WRAITH);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = requireVerifiedCrawlerSourceSnapshot(this.task);
    const content = snapshot.content;
    const asyncScriptCount = (content.match(/<script\b[^>]*(?:\sasync(?:\s|=|>)|\sdefer(?:\s|=|>))/gi) || []).length;
    const eventStreamMarkers = countMatches(content, /\b(?:EventSource|WebSocket|server-sent events?|text\/event-stream)\b/gi);
    const backgroundWorkMarkers = countMatches(content, /\b(?:job status|background job|polling|worker|queue|progress endpoint)\b/gi);
    const output = Object.freeze({
      function: 'passive-async-structure-observation',
      asyncScriptCount,
      eventStreamMarkers,
      backgroundWorkMarkers,
      observedCharacters: content.length,
      probesPerformed: 0,
    });
    return [attachCrawlerCapabilityOutput(
      this.generateEntropySignature(output),
      snapshot,
      output,
    )];
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return (value.match(pattern) || []).length;
}
