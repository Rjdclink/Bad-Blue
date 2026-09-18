import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';
import { discoverCriminalRecordSources } from '../CriminalSourceDiscovery';

/**
 * Warrant-source discovery adapter.
 *
 * There is no single nationwide public warrant database. This adapter discovers
 * verified state/county court source portals and never converts an unverified
 * web result into an active-warrant assertion.
 */
export class WarrantDatabaseScraper extends LegacyScraperAdapter {
  protected sourceName = 'Official Warrant Source Discovery';
  protected baseConfidence = 0.80;

  async search(query: CriminalSearchQuery, _page: Page): Promise<ScraperResult> {
    try {
      const discovery = await discoverCriminalRecordSources(query);
      const matching = discovery.filter(source =>
        source.kind === 'state_court' || source.kind === 'county_court_directory'
      );
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
        reachable.length > 0 ? undefined : 'No verified warrant-capable official source portal was reachable',
      );
    } catch (error) {
      return this.createResult([], false, error instanceof Error ? error.message : String(error));
    }
  }
}
