import { createSpectraKeylessProviders } from './SpectraKeylessProviders';
import type { discoverLegalMeshTier3 } from '../../lexara/LegalProviderMesh';
import type { retrieveSpectraPublicEvidence, SpectraRetrievedEvidence, SpectraHtmlEnhancer } from './SpectraPublicRetrieval';

/** Spectra-only composition preserves the shared Lexara provider policy. */
export function createSpectraProviderConnections(deps: {
  discover: typeof discoverLegalMeshTier3;
  retrieve: typeof retrieveSpectraPublicEvidence;
  validate: (url: string) => Promise<URL>;
  providers?: ReturnType<typeof createSpectraKeylessProviders>;
}) {
  const providers = deps.providers || createSpectraKeylessProviders();
  const enhance: SpectraHtmlEnhancer = async (html, evidence, signal) => {
    // Successful HTML only. Do not send challenge/login/error pages to a second provider.
    if (/captcha|verify (?:you are|that you are) human|access denied|sign in to continue|type=[\'"]?password|cf-chl-/i.test(html)) return evidence;
    const sparse = (evidence.textExcerpt || '').trim().length < 200;
    const [local, rendered] = await Promise.allSettled([
      providers.extract(html, evidence.url, signal),
      sparse ? deps.validate(evidence.url).then(url => providers.read(url.href, signal)) : Promise.resolve(null),
    ]);
    if (signal?.aborted) return evidence;
    const markdown = local.status === 'fulfilled' ? local.value : null;
    const reader = rendered.status === 'fulfilled' ? rendered.value : null;
    // Reader text is supplemental page content, never a location measurement.
    if (reader && reader.length > (evidence.textExcerpt || '').length) {
      return { ...evidence, textExcerpt: reader, textExtractionProvider: 'jina-reader' };
    }
    return markdown ? { ...evidence, textExcerpt: markdown, textExtractionProvider: 'crawl4ai' } : evidence;
  };
  return {
    async discover(...args: Parameters<typeof discoverLegalMeshTier3>) {
      const [query, signal, options] = args;
      if (signal?.aborted) return [];
      const controller = new AbortController();
      const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const searches = [
          Promise.resolve().then(() => deps.discover(query, lifetime, options)),
          providers.search(query, lifetime),
        ];
        if (options?.firstUseful) {
          // Preserve acquisition's first-useful latency and cancel losing work.
          const first = await new Promise<Awaited<ReturnType<typeof discoverLegalMeshTier3>>>(resolve => {
            let pending = searches.length;
            for (const search of searches) search.then(rows => {
              if (rows.length) resolve(rows);
            }, () => undefined).finally(() => { if (--pending === 0) resolve([]); });
          });
          return signal?.aborted ? [] : first;
        }
        const settled = await Promise.allSettled(searches);
        // Keep already-returned native leads when a slower lane hits the pass deadline.
        const results = new Map<string, Awaited<ReturnType<typeof discoverLegalMeshTier3>>[number]>();
        for (const group of settled) {
          if (group.status !== 'fulfilled') continue;
          for (const item of group.value) if (!results.has(item.url)) results.set(item.url, item);
        }
        return [...results.values()];
      } finally { controller.abort(); }
    },
    retrieve(targets: string[], signal?: AbortSignal, diagnostic?: Parameters<typeof retrieveSpectraPublicEvidence>[2]): Promise<SpectraRetrievedEvidence[]> {
      return deps.retrieve(targets, signal, diagnostic, enhance);
    },
  };
}
