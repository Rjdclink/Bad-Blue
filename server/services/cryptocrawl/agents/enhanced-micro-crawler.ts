// LEGACY COMPATIBILITY SHELL
//
// EnhancedMicroCrawler belonged to the retired Eden/LuxSwarm simulation stack.
// It is intentionally retained only so historical imports compile. It MUST NOT
// discover, execute, fabricate profit, mutate canonical opportunity state, or
// participate in CryptoCrawler trading authority.

import { randomUUID } from 'crypto';
import type { MicroCrawlerState, ChainId } from '../eden/types';

export type CrawlerMode = 'micro' | 'full';
export type CrawlerStatus = 'idle' | 'scanning' | 'executing' | 'shrinking' | 'growing';

export class EnhancedMicroCrawler {
  id: string;
  parentCainId: string;
  mode: CrawlerMode;
  priority = 0;
  target?: string;
  chain?: ChainId;
  status: CrawlerStatus = 'idle';
  lastActivity: number;
  profitGenerated = 0;

  constructor(parentCainId: string, mode: CrawlerMode = 'micro') {
    this.id = `legacy-micro-${randomUUID().split('-')[0]}`;
    this.parentCainId = parentCainId;
    this.mode = mode;
    this.lastActivity = Date.now();
  }

  /**
   * Compatibility-only observation hook.
   *
   * Historical versions simulated fills and profit with randomized values. That
   * behavior is retired. Canonical discovery/execution is owned by measured
   * opportunity state + governed execution/settlement paths.
   */
  async crawl(): Promise<void> {
    this.lastActivity = Date.now();
    this.status = 'idle';
    this.priority = 0;
    this.target = undefined;
    this.chain = undefined;
    this.profitGenerated = 0;
  }

  getState(): MicroCrawlerState {
    return {
      id: this.id,
      parentCainId: this.parentCainId,
      mode: this.mode,
      priority: this.priority,
      target: this.target,
      chain: this.chain,
      status: this.status,
      lastActivity: this.lastActivity,
      profitGenerated: 0,
    };
  }
}
