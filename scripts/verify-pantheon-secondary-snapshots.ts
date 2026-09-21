import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HydraCrawler } from '../server/services/pantheon/crawlers/hydra';
import { WraithCrawler } from '../server/services/pantheon/crawlers/wraith';
import { IceCrawler } from '../server/services/pantheon/crawlers/ice';
import { FarmCrawler, NovaCrawler, PhantomCrawler } from '../server/services/pantheon/crawlers/utility';
import {
  CrawlerType,
  type CrawlerSourceSnapshot,
  type CrawlerTask,
  type EntropySignature,
} from '../server/services/pantheon/core';
import { TwoStageDeployer } from '../server/services/pantheon/razors/TwoStageDeployer';
import { PANTHEON_SECONDARY_CRAWLER_IDS } from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';

const crawlerFiles = ['hydra', 'wraith', 'ice', 'utility'].map(name =>
  `server/services/pantheon/crawlers/${name}.ts`
);
for (const file of crawlerFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} must not issue network fetches`);
  assert.doesNotMatch(source, /\baxios\b/, `${file} must not use an alternate network client`);
  assert.doesNotMatch(source, /method\s*:\s*['"]HEAD['"]|\.head\s*\(/i, `${file} must not issue probe requests`);
}

const html = `<!doctype html><html><head>
  <title>Jane Doe Public Record</title>
  <meta name="description" content="Verified public court record">
  <script async>const worker = 'background job polling';</script>
</head><body>
  <a href="/docket/123">Docket 123</a>
  <a href="/document.pdf">Document</a>
  <table><tr><th>Case</th></tr><tr><td>123</td></tr></table>
  <form action="/public-search"><input name="query" required></form>
  Jane Doe court filing official public record.
</body></html>`;
const snapshot: Readonly<CrawlerSourceSnapshot> = Object.freeze({
  sourceUrl: 'https://example.gov/records/jane-doe',
  content: html,
  contentType: 'text/html',
  retrievedAt: new Date().toISOString(),
  provenance: 'canonical-primary-live-get',
  verified: true,
});

const specs: Array<{
  type: CrawlerType;
  create: (task: CrawlerTask) => { execute(): Promise<EntropySignature[]> };
  expectedFunction: string;
}> = [
  { type: CrawlerType.HYDRA, create: task => new HydraCrawler(task), expectedFunction: 'snapshot-link-discovery' },
  { type: CrawlerType.WRAITH, create: task => new WraithCrawler(task), expectedFunction: 'passive-async-structure-observation' },
  { type: CrawlerType.ICE, create: task => new IceCrawler(task), expectedFunction: 'snapshot-structured-extraction' },
  { type: CrawlerType.FARM, create: task => new FarmCrawler(task), expectedFunction: 'snapshot-evidence-fingerprinting' },
  { type: CrawlerType.PHANTOM, create: task => new PhantomCrawler(task), expectedFunction: 'snapshot-structural-observation' },
  { type: CrawlerType.NOVA, create: task => new NovaCrawler(task), expectedFunction: 'snapshot-salient-term-extraction' },
];

function taskFor(type: CrawlerType, includeSnapshot: boolean): CrawlerTask {
  return {
    id: `snapshot-test-${type}`,
    type,
    target: snapshot.sourceUrl,
    priority: 10,
    quantum: 2_000,
    entropyBudget: 20,
    ...(includeSnapshot ? { sourceSnapshot: snapshot } : {}),
  };
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async () => {
  networkCalls += 1;
  throw new Error('Secondary crawler attempted a forbidden network request');
}) as typeof fetch;

try {
  for (const spec of specs) {
    const signatures = await spec.create(taskFor(spec.type, true)).execute();
    assert.ok(signatures.length > 0, `${spec.type} must produce attributable snapshot output`);
    assert.ok(signatures.every(signature => signature.source?.verified === true));
    assert.ok(signatures.every(signature => signature.source?.url === snapshot.sourceUrl));
    assert.ok(signatures.some(signature => signature.capabilityOutput?.function === spec.expectedFunction));

    await assert.rejects(
      () => spec.create(taskFor(spec.type, false)).execute(),
      /verified canonical source snapshot is required/,
      `${spec.type} must fail explicitly without verified content`,
    );
  }

  const deployer = new TwoStageDeployer();
  const available = await deployer.deployBackgroundReport(
    snapshot.sourceUrl,
    snapshot.content,
    5_000,
    PANTHEON_SECONDARY_CRAWLER_IDS,
  );
  assert.equal(available.secondaryResults.length, PANTHEON_SECONDARY_CRAWLER_IDS.length);
  assert.ok(available.secondaryResults.every(result => result.attempted && result.signatures.length > 0));
  assert.ok(available.audit.every(entry => entry.attempts === 1 && entry.capabilityOutput));

  const unavailable = await deployer.deployBackgroundReport(
    snapshot.sourceUrl,
    undefined,
    5_000,
    PANTHEON_SECONDARY_CRAWLER_IDS,
  );
  assert.equal(unavailable.secondaryResults.length, PANTHEON_SECONDARY_CRAWLER_IDS.length);
  assert.ok(unavailable.secondaryResults.every(result => result.status === 'unavailable_no_content'));
  assert.ok(unavailable.secondaryResults.every(result => result.attempted === false));
  assert.ok(unavailable.audit.every(entry => entry.attempts === 0 && entry.evidenceCount === 0));
  assert.equal(networkCalls, 0, 'secondary capability execution must make zero network requests');
  assert.equal(Object.isFrozen(snapshot), true, 'source snapshot must remain read-only');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Pantheon secondary snapshot execution verification passed.');
