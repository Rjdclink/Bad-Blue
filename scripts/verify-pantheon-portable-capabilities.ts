import {
  PANTHEON_CATEGORY_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_REPORT_CATEGORY_LABELS,
} from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';
import { runPortablePantheonCapabilities } from '../server/services/pantheon/PantheonPortableCapabilityExecutor';

const audits = await runPortablePantheonCapabilities({
  capabilityIds: PANTHEON_PORTABLE_CAPABILITY_IDS,
  sourceUrl: 'https://www.example.gov/records/jane-doe',
  content: '<html><title>Jane Doe public court record</title><a href="https://www.example.gov/docket/1">Docket</a><body>Jane Doe filed court case docket 123 in Ohio. Official public record.</body></html>',
  subject: 'Jane Doe',
  location: 'Ohio',
});

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
  if (!audit.capabilityOutput?.contentHash || audit.capabilityOutput.contentHash.length !== 64) {
    throw new Error(`Portable capability ${audit.crawler} did not return a live-content digest`);
  }
  const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[audit.crawler];
  if (descriptor.executionMode !== 'credential-free-equivalent' || !descriptor.replacementDisclosure) {
    throw new Error(`Portable capability ${audit.crawler} omitted its credential-free replacement disclosure`);
  }
}

console.log(`Pantheon portable capability runtime passed: ${audits.length} attributable credential-free outcomes.`);
