import {
  PANTHEON_CATEGORY_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_REPORT_CATEGORY_LABELS,
} from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';
import { runPortablePantheonCapabilities } from '../server/services/pantheon/PantheonPortableCapabilityExecutor';
import type { PantheonExecutableSource, PantheonPortableCapabilityId } from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';

function fixtureFor(capabilityId: PantheonPortableCapabilityId): PantheonExecutableSource {
  const base = {
    transport: 'direct-http' as const,
    sourceKind: 'public-page' as const,
    authority: 'primary' as const,
    jurisdiction: 'US-OH',
    workType: 'candidate-validation' as const,
    subjectScoped: true,
  };
  if (capabilityId === 'openrouter-web-search') return {
    ...base,
    sourceUrl: 'https://www.bing.com/search?q=Jane+Doe',
    transport: 'search-provider',
    sourceKind: 'search',
    authority: 'discovery',
    registryCategory: 'identity',
    workType: 'discovery-search',
  };
  if (['fast-people-search', 'true-people-search', 'whitepages'].includes(capabilityId)) {
    return { ...base, sourceUrl: 'https://directory.example.gov/people/jane-doe', registryCategory: 'identity' };
  }
  if (capabilityId === 'social-media-scraper') {
    return { ...base, sourceUrl: 'https://social.example.gov/profile/jane-doe', registryCategory: 'social' };
  }
  if (capabilityId === 'beneficial') {
    return { ...base, sourceUrl: 'https://business.example.gov/entity/jane-doe', registryCategory: 'business' };
  }
  if (capabilityId === 'pacer') {
    return { ...base, sourceUrl: 'https://www.courtlistener.com/docket/1/jane-doe/', registryCategory: 'courts' };
  }
  if (capabilityId === 'state-court') {
    return { ...base, sourceUrl: 'https://judiciary.example.gov/case/jane-doe', registryCategory: 'courts' };
  }
  if (capabilityId === 'county-court') {
    return { ...base, sourceUrl: 'https://examplecounty.gov/clerk/case/jane-doe', registryCategory: 'courts' };
  }
  if (capabilityId === 'warrant-database') {
    return { ...base, sourceUrl: 'https://sheriff.example.gov/warrants/jane-doe', registryCategory: 'warrants' };
  }
  if (capabilityId === 'sex-offender-registry') {
    return { ...base, sourceUrl: 'https://registry.example.gov/offender/jane-doe', registryCategory: 'sex-offender' };
  }
  if (['instant-legal', 'adaptive-legal', 'legal-crawler'].includes(capabilityId)) {
    return { ...base, sourceUrl: 'https://court.example.gov/case/jane-doe', registryCategory: 'courts' };
  }
  return { ...base, sourceUrl: 'https://www.example.gov/records/jane-doe', registryCategory: 'identity' };
}

const audits = (await Promise.all(PANTHEON_PORTABLE_CAPABILITY_IDS.map(async capabilityId => {
  const source = fixtureFor(capabilityId);
  return runPortablePantheonCapabilities({
    capabilityIds: [capabilityId],
    sourceUrl: source.sourceUrl,
    content: '<html><title>Jane Doe public profile and court record</title><a href="https://www.example.gov/docket/1">Docket</a><body>Jane Doe address phone email profile username owner officer company public record filed in federal state county court case docket 123 in Ohio; warrant registry status unavailable.</body></html>',
    subject: 'Jane Doe',
    location: 'Ohio',
    sourceContext: source,
  });
}))).flat();

const capabilityIds = Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX);
if (capabilityIds.length !== 53) {
  throw new Error(`Expected 53 non-crypto Pantheon capabilities; received ${capabilityIds.length}`);
}
const routedCapabilities = new Set(PANTHEON_REPORT_CATEGORY_LABELS.flatMap(
  category => [...PANTHEON_CATEGORY_CAPABILITY_MATRIX[category]],
));
for (const capabilityId of capabilityIds) {
  if (!routedCapabilities.has(capabilityId as keyof typeof PANTHEON_CRAWLER_CAPABILITY_MATRIX)) {
    throw new Error(`Pantheon capability ${capabilityId} has no permitted report category`);
  }
}

if (audits.length !== PANTHEON_PORTABLE_CAPABILITY_IDS.length) {
  throw new Error(`Expected ${PANTHEON_PORTABLE_CAPABILITY_IDS.length} portable capability outcomes; received ${audits.length}`);
}
for (const audit of audits) {
  if (audit.attempts !== 1 || audit.targets !== 1 || audit.sourceOutcomes.length !== 1) {
    throw new Error(`Portable capability ${audit.crawler} did not return an attributable execution outcome`);
  }
  if (audit.status === 'failed' || audit.capabilityOutput?.sourceCompatible !== true) {
    throw new Error(`Portable capability ${audit.crawler} was not routed to a source matching its declared skill`);
  }
  if (!audit.capabilityOutput?.contentHash || audit.capabilityOutput.contentHash.length !== 64) {
    throw new Error(`Portable capability ${audit.crawler} did not return a live-content digest`);
  }
  const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[audit.crawler];
  if (descriptor.executionMode !== 'credential-free-equivalent' || !descriptor.replacementDisclosure) {
    throw new Error(`Portable capability ${audit.crawler} omitted its credential-free replacement disclosure`);
  }
}

console.log(`Pantheon portable capability runtime passed: ${audits.length} attributable credential-free outcomes.`);
