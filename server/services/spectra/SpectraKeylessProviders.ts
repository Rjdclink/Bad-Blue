import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { beginDiscoveryAttempt, discoveryFetch, discoverySignal } from '../../lexara/DiscoveryDiagnostics';
import type { LegalMeshCandidate } from '../../lexara/LegalProviderMesh';

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 320_000;
const failure = (code: string) => Object.assign(new Error(code), { code });
type Lane = 'firecrawlKeyless' | 'jinaReader' | 'crawl4ai';

/** Process-wide bounds: anonymous quotas are shared by the deployment's IP. */
export function createSpectraKeylessProviders({
  transport = fetch, env = process.env, now = Date.now,
  localExtract = extractWithLocalCrawl4AI,
}: { transport?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => number;
  localExtract?: typeof extractWithLocalCrawl4AI } = {}) {
  const state = new Map<Lane, { calls: number[]; active: number; blockedUntil: number }>();
  async function run<T>(lane: Lane, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    const report = beginDiscoveryAttempt(lane);
    const parent = discoverySignal(signal);
    const row = state.get(lane) || { calls: [], active: 0, blockedUntil: 0 };
    state.set(lane, row);
    let admitted = false;
    const timeout = AbortSignal.timeout(lane === 'crawl4ai' ? 3_000 : 8_000);
    const lifetime = parent ? AbortSignal.any([parent, timeout]) : timeout;
    try {
      parent?.throwIfAborted();
      if (env[`SPECTRA_${lane === 'firecrawlKeyless' ? 'FIRECRAWL' : lane === 'jinaReader' ? 'JINA' : 'CRAWL4AI'}_ENABLED`] === 'false') {
        throw failure('DISCOVERY_DISABLED');
      }
      if (row.blockedUntil > now()) throw failure('DISCOVERY_COOLDOWN');
      row.calls = row.calls.filter(t => now() - t < 60_000);
      // Leave headroom below Jina's anonymous 20 RPM. No automatic retries.
      if (row.active >= 2 || row.calls.length >= (lane === 'firecrawlKeyless' ? 6 : 18)) throw failure('DISCOVERY_LOCAL_RATE_LIMIT');
      if (lane === 'crawl4ai' && !env.SPECTRA_CRAWL4AI_PYTHON) throw failure('DISCOVERY_NOT_CONFIGURED');
      row.calls.push(now()); row.active++; admitted = true; report.dispatch();
      const result = await work(lifetime);
      lifetime.throwIfAborted();
      report(result === null || (Array.isArray(result) && !result.length) ? 'empty' : 'ok');
      return result;
    } catch (error: any) {
      const match = /^Discovery HTTP (\d+)$/.exec(String(error?.message));
      if (match && [401, 402, 403, 429].includes(Number(match[1]))) {
        // Never immediately retry authentication, access or anonymous quota denials.
        row.blockedUntil = now() + (Number(match[1]) === 429 ? 86_400_000 : 3_600_000);
      }
      report(parent?.aborted ? 'cancelled' : timeout.aborted ? 'timeout'
        : String(error?.code || '').startsWith('DISCOVERY_') ? 'skipped' : 'failed', error);
      return null;
    } finally { if (admitted) row.active--; }
  }
  async function json(url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
    const response = await discoveryFetch(transport, url, { ...init, signal, redirect: 'error' });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new SyntaxError('Oversize provider response');
      reader = response.body?.getReader();
      const chunks: Buffer[] = []; let bytes = 0;
      while (reader) {
        const part = await reader.read(); signal.throwIfAborted();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) throw new SyntaxError('Oversize provider response');
        chunks.push(Buffer.from(part.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      else void response.body?.cancel().catch(() => undefined);
    }
  }
  return {
    async search(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
      if (!query.trim()) return [];
      return await run('firecrawlKeyless', async lifetime => {
        const payload = await json('https://api.firecrawl.dev/v2/search', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: query.slice(0, 2_000), limit: 5, sources: ['web'], timeout: 7000 }),
        }, lifetime);
        if (payload?.success !== true || !Array.isArray(payload.data?.web)) throw new SyntaxError('Invalid search response');
        const found: LegalMeshCandidate[] = []; const seen = new Set<string>();
        for (const item of payload.data.web.slice(0, 20)) {
          if (typeof item?.url !== 'string') continue;
          let url: URL; try { url = new URL(item.url); } catch { continue; }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
          url.hash = '';
          if (seen.has(url.href)) continue;
          seen.add(url.href);
          found.push({ url: url.href, title: typeof item.title === 'string' ? item.title.slice(0, 500) : url.hostname,
            excerpt: typeof item.description === 'string' ? item.description.slice(0, 4_000) : undefined,
            tier: 3, provider: 'firecrawl-keyless' });
          if (found.length === 5) break;
        }
        return found;
      }, signal) || [];
    },
    /** Call only for an already-fetched, public, successful HTML source. */
    async read(url: string, signal?: AbortSignal): Promise<string | null> {
      return run('jinaReader', async lifetime => {
        const payload = await json(`https://r.jina.ai/${url}`, {
          headers: { Accept: 'application/json', 'X-Respond-With': 'markdown', 'X-With-Generated-Alt': 'false', 'X-Respond-Timing': 'visible-content' },
        }, lifetime);
        if (payload?.code !== 200 || typeof payload.data?.content !== 'string'
          || payload.data.url !== url) throw new SyntaxError('Invalid reader response');
        return payload.data.content.trim().slice(0, MAX_TEXT) || null;
      }, signal);
    },
    async extract(html: string, url: string, signal?: AbortSignal): Promise<string | null> {
      return run('crawl4ai', lifetime => localExtract(env.SPECTRA_CRAWL4AI_PYTHON!, html, url, lifetime), signal);
    },
  };
}

/** No HTTP server, credentials, LLM calls or browser needed for local HTML extraction. */
export async function extractWithLocalCrawl4AI(python: string, html: string, url: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) throw new SyntaxError('Oversize HTML');
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, [resolve('scripts/spectra-crawl4ai.py')], {
      stdio: ['pipe', 'pipe', 'ignore'], shell: false,
      // The extractor receives no application credentials or database URLs.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONIOENCODING: 'utf-8',
        OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
    });
    const output: Buffer[] = []; let size = 0; let failureReason: unknown;
    const stop = (reason: unknown) => { failureReason = reason; child.kill('SIGKILL'); };
    const abort = () => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) stop(new SyntaxError('Oversize extractor output'));
      else output.push(chunk);
    });
    child.stdin.on('error', () => { /* close/error owns settlement */ });
    child.on('error', reject);
    child.on('close', code => {
      signal.removeEventListener('abort', abort);
      if (failureReason || code !== 0) return reject(failureReason || new Error('Local extraction failed'));
      try {
        const result = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (typeof result.markdown !== 'string') throw new SyntaxError('Invalid extractor response');
        resolveResult(result.markdown.trim().slice(0, MAX_TEXT) || null);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ html, url }));
  });
}
