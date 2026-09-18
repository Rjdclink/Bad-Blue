import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';
import { discoverCriminalRecordSources } from '../CriminalSourceDiscovery';

/**
 * Official-source discovery adapter.
 *
 * This route deliberately does not fabricate person-level records from generic
 * DOM selectors. It verifies and returns the relevant public source portals;
 * a source-specific query adapter must supply a person-level match.
 */
export class CountyCourtScraper extends LegacyScraperAdapter {
  protected sourceName = 'County Courts';
  protected baseConfidence = 0.90;

  async search(query: CriminalSearchQuery, _page: Page): Promise<ScraperResult> {
    try {
      const discovery = await discoverCriminalRecordSources(query);
      const matching = discovery.filter(source => source.kind === 'county_court_directory');
      const reachable = matching.filter(source => source.status === 'reachable');

      return this.createResult(
        reachable.length
          ? [{
              fullName: query.fullName,
              dateOfBirth: query.dateOfBirth,
              source: this.sourceName,
              confidence: this.baseConfidence,
              scrapedAt: new Date(),
              searchStatus: 'sources_discovered',
              sourceDiscovery: matching,
            }]
          : [],
        reachable.length > 0,
        reachable.length > 0 ? undefined : 'No verified official source portal was reachable',
      );
    } catch (error) {
      return this.createResult([], false, error instanceof Error ? error.message : String(error));
    }
  }
}
