// Criminal Records Aggregator - Main Orchestrator
import type { CriminalSearchQuery, CriminalRecord } from './types';
import { discoverCriminalRecordSources } from './CriminalSourceDiscovery';

export class CriminalRecordsAggregator {
  async search(query: CriminalSearchQuery): Promise<CriminalRecord> {
    console.log('[CriminalRecords] Starting search:', query);

    const sourceDiscovery = await discoverCriminalRecordSources(query);
    const reachableSources = sourceDiscovery.filter(source => source.status === 'reachable');

    // Discovery is performed by the existing bounded crawler set. Person-level
    // record extraction remains disabled until each portal has a verified query adapter.
    return {
      fullName: query.fullName,
      dateOfBirth: query.dateOfBirth,
      charges: [],
      arrests: [],
      convictions: [],
      activeWarrants: [],
      sexOffenderStatus: { registered: false },
      incarcerationHistory: [],
      source: 'Crawler-discovered official source portals',
      confidence: 0,
      riskScore: 0,
      scrapedAt: new Date(),
      searchStatus: reachableSources.length > 0 ? 'sources_discovered' : 'sources_unavailable',
      sourceDiscovery,
    };
  }
}

export const criminalRecordsAggregator = new CriminalRecordsAggregator();
