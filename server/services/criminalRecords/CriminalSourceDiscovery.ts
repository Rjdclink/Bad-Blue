import { crawlSeedOnceWithCrawlers, sanitizeUrlStrict } from '../../lib/seedFirstOsint';
import {
  pantheonRetrievalAdapter,
  type CrawlerSelectionPlan,
  type CrawlerSupervisionResult,
  type RetrievalEvidence,
} from '../crawlers';
import type { CriminalSearchQuery } from './types';

export type CriminalSourceKind = 'state_court' | 'county_court_directory' | 'sex_offender_registry';

export interface CriminalSourceDiscovery {
  kind: CriminalSourceKind;
  seedUrl: string;
  status: 'reachable' | 'unreachable';
  title?: string;
  links: string[];
  crawlerAttempts: Array<{
    crawlerName: string;
    status: 'success' | 'fail' | 'timeout' | 'aborted' | 'disabled';
    durationMs: number;
  }>;
  crawlerSelection: CrawlerSelectionPlan;
  fullCrawlerAvailable: boolean;
  fullCrawlerReason?: string;
  retrievalEvidence: RetrievalEvidence[];
  fullCrawlerSupervision?: CrawlerSupervisionResult;
  discoveredAt: Date;
}

const STATE_COURT_PORTALS: Record<string, string> = {
  AL:'https://judicial.alabama.gov/', AK:'https://courts.alaska.gov/', AZ:'https://www.azcourts.gov/',
  AR:'https://arcourts.gov/', CA:'https://courts.ca.gov/', CO:'https://www.coloradojudicial.gov/',
  CT:'https://jud.ct.gov/', DE:'https://courts.delaware.gov/', FL:'https://www.flcourts.gov/',
  GA:'https://georgiacourts.gov/', HI:'https://www.courts.state.hi.us/', ID:'https://isc.idaho.gov/',
  IL:'https://www.illinoiscourts.gov/', IN:'https://www.in.gov/courts/', IA:'https://www.iowacourts.gov/',
  KS:'https://www.kscourts.org/', KY:'https://www.kycourts.gov/', LA:'https://www.lasc.org/',
  ME:'https://www.courts.maine.gov/', MD:'https://www.mdcourts.gov/', MA:'https://www.mass.gov/orgs/massachusetts-court-system',
  MI:'https://www.courts.michigan.gov/', MN:'https://www.mncourts.gov/', MS:'https://courts.ms.gov/',
  MO:'https://www.courts.mo.gov/', MT:'https://courts.mt.gov/', NE:'https://supremecourt.nebraska.gov/',
  NV:'https://nvcourts.gov/', NH:'https://www.courts.nh.gov/', NJ:'https://www.njcourts.gov/',
  NM:'https://www.nmcourts.gov/', NY:'https://ww2.nycourts.gov/', NC:'https://www.nccourts.gov/',
  ND:'https://www.ndcourts.gov/', OH:'https://www.supremecourt.ohio.gov/', OK:'https://www.oscn.net/',
  OR:'https://www.courts.oregon.gov/', PA:'https://www.pacourts.us/', RI:'https://www.courts.ri.gov/',
  SC:'https://www.sccourts.org/', SD:'https://ujs.sd.gov/', TN:'https://www.tncourts.gov/',
  TX:'https://www.txcourts.gov/', UT:'https://www.utcourts.gov/', VT:'https://www.vermontjudiciary.org/',
  VA:'https://www.vacourts.gov/', WA:'https://www.courts.wa.gov/', WV:'https://www.courtswv.gov/',
  WI:'https://www.wicourts.gov/', WY:'https://www.courts.state.wy.us/', DC:'https://www.dccourts.gov/',
};

function buildOfficialSourceSeeds(query: CriminalSearchQuery): Array<{ kind: CriminalSourceKind; url: string }> {
  const sources: Array<{ kind: CriminalSourceKind; url: string }> = [
    { kind: 'county_court_directory', url: 'https://www.usa.gov/state-courts' },
    { kind: 'sex_offender_registry', url: 'https://www.nsopw.gov/' },
  ];
  const statePortal = query.state ? STATE_COURT_PORTALS[query.state.toUpperCase()] : undefined;
  if (statePortal) sources.unshift({ kind: 'state_court', url: statePortal });
  return sources;
}

/**
 * Locates public, official criminal-record source portals. Discovery does not
 * make a person-level record determination; each portal needs a verified query adapter.
 */
export async function discoverCriminalRecordSources(
  query: CriminalSearchQuery
): Promise<CriminalSourceDiscovery[]> {
  const sourceSeeds = buildOfficialSourceSeeds(query);
  const fullCrawlerRetrieval = await pantheonRetrievalAdapter.retrieve({
    purpose: 'criminal_source_discovery',
    targets: sourceSeeds.map(source => source.url),
    depth: 4,
  });
  const crawlerSelection = fullCrawlerRetrieval.plan;

  return Promise.all(sourceSeeds.map(async ({ kind, url }) => {
    const retrievalEvidence = fullCrawlerRetrieval.evidence.filter(evidence => evidence.target === url);
    const sanitized = sanitizeUrlStrict(url);
    if (!sanitized.ok) {
      return {
        kind,
        seedUrl: url,
        status: 'unreachable' as const,
        links: [],
        crawlerAttempts: [],
        crawlerSelection,
        fullCrawlerAvailable: fullCrawlerRetrieval.available,
        fullCrawlerReason: fullCrawlerRetrieval.reason,
        retrievalEvidence,
        fullCrawlerSupervision: fullCrawlerRetrieval.supervision,
        discoveredAt: new Date(),
      };
    }

    const crawl = await crawlSeedOnceWithCrawlers(sanitized.normalized);
    return {
      kind,
      seedUrl: sanitized.normalized,
      status: crawl.ok ? 'reachable' as const : 'unreachable' as const,
      title: crawl.extract.title,
      links: crawl.extract.links.slice(0, 100),
      crawlerAttempts: crawl.attempts.map(({ crawlerName, status, durationMs }) => ({
        crawlerName,
        status,
        durationMs,
      })),
      crawlerSelection,
      fullCrawlerAvailable: fullCrawlerRetrieval.available,
      fullCrawlerReason: fullCrawlerRetrieval.reason,
      retrievalEvidence,
      fullCrawlerSupervision: fullCrawlerRetrieval.supervision,
      discoveredAt: new Date(),
    };
  }));
}