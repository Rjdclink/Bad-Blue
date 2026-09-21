import { StarTrekCrawler } from '../server/services/crawlers/StarTrekCrawler';
import { BirdOfPreyCrawler } from '../server/services/crawlers/BirdOfPreyCrawler';
import { SixDegreesCrawler } from '../server/services/crawlers/SixDegreesCrawler';

const originalFetch = globalThis.fetch;
const originalRandom = Math.random;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function htmlResponse(body: string, status = 200, headers: Record<string,string> = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}

async function main() {
  Math.random = () => 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('unreachable.invalid')) return htmlResponse('unavailable', 503);
    if (init?.method === 'HEAD') return htmlResponse('', 200);
    if (url.includes('graph.test')) {
      return htmlResponse('<html><body><a href="https://alpha.test/profile">Alpha</a><a href="https://beta.test/about">Beta</a></body></html>');
    }
    if (url.includes('alpha.test')) return htmlResponse('<html><body>Alpha profile <a href="https://graph.test/">Home</a></body></html>');
    if (url.includes('beta.test')) return htmlResponse('<html><body>Beta profile</body></html>');
    return htmlResponse('<html><body>verified crawler evidence</body></html>');
  }) as typeof fetch;

  const star = new StarTrekCrawler();
  star.setPrimeDirective(false);
  await star.setPhaserSetting(10);
  star.setNavigationSeeds(['https://graph.test', 'https://alpha.test', 'https://beta.test']);
  assert((await star.longRangeScan()).length === 3, 'StarTrek long-range discovery failed');
  const starData = await star.warpTo('https://graph.test');
  assert(starData.content.includes('verified crawler evidence'), 'StarTrek retrieval/extraction failed');
  assert(starData.confidence > 0 && starData.metadata?.warpFactor === 5, 'StarTrek evidence metadata/confidence failed');
  const starFailure = await star.firePhaser('https://unreachable.invalid');
  assert(starFailure.confidence === 0 && starFailure.content === '', 'StarTrek failure must fail closed');
  console.log('PASS startrek: discovery, retrieval, extraction, metadata, failure semantics');

  const stealth = { connect: async () => undefined } as any;
  const phylactery = {} as any;
  const bird = new BirdOfPreyCrawler(stealth, phylactery);
  await bird.perfectCloak();
  assert(await bird.fireWhileCloaked(), 'BirdOfPrey cloaked execution failed');
  const birdData = await bird.fireDisruptors('https://graph.test', 10);
  assert(birdData.content.includes('verified crawler evidence') && birdData.confidence > 0, 'BirdOfPrey retrieval/extraction failed');
  const skipped = await bird.hunt('not a url');
  assert(skipped.confidence === 0 && skipped.metadata?.skipped === true, 'BirdOfPrey invalid target must fail closed');
  console.log('PASS birdofprey: cloak, bounded retrieval, extraction, invalid-target failure semantics');

  const six = new SixDegreesCrawler(stealth, phylactery);
  const graph = await six.mapConnections('graph.test', 1);
  assert(graph.nodes.length === 1, 'SixDegrees must admit successfully fetched seed');
  assert(graph.edges.some(edge => edge.to === 'alpha.test') && graph.edges.some(edge => edge.to === 'beta.test'), 'SixDegrees relationship discovery failed');
  const failedGraph = await six.mapConnections('unreachable.invalid', 1);
  assert(failedGraph.nodes.length === 0 && failedGraph.edges.length === 0, 'SixDegrees unreachable target must not become evidence');
  console.log('PASS sixdegrees: live graph acquisition, relationship extraction, state isolation, failure semantics');

  console.log('PANTHEON core crawler batch 1 behavioral verification passed.');
}

main().finally(() => {
  globalThis.fetch = originalFetch;
  Math.random = originalRandom;
}).catch(error => {
  console.error(error);
  process.exit(1);
});
