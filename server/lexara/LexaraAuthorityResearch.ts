        return [{
          url,
          title: item.title || 'Legal authority source',
          excerpt: item.description || item.markdown,
        }];
      });
    } catch (error) {
      console.warn('[LEXARA Authority] Firecrawl discovery failed route-locally', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      clearTimeout(timer);
    }
  };

  const openRouterDiscovery = async (): Promise<Discovered[]> => {
    try {
      const search = await orchestratedWebSearch(query, {
        useOnlinePlugin: true,
        timeout: RESEARCH_TIMEOUT_MS,
      });
      return search.sources.flatMap(urlValue => {
        const url = cleanUrl(urlValue);
        return url ? [{ url, title: 'Web-discovered legal authority' }] : [];
      });
    } catch (error) {
      console.warn('[LEXARA Authority] OpenRouter web discovery unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  // Run independent discovery paths in parallel under a conversational latency
  // budget. Authority discovery is valuable evidence, but a slow crawler must
  // never hold the live spoken answer hostage.
  const [firecrawlResult, openRouterResult] = await Promise.all([
    firecrawlDiscovery(),
    openRouterDiscovery(),
  ]);

  const seen = new Set<string>();
  const sources: LexaraAuthoritySource[] = [];
  const add = (item: Discovered) => {
    const url = cleanUrl(item.url);
    if (!url || seen.has(url) || sources.length >= MAX_AUTHORITY_SOURCES) return;
    seen.add(url);
    sources.push({
      title: item.title.trim().slice(0, 240) || 'Legal authority source',
      url,
      kind: classifySource(url),
      excerpt: item.excerpt?.trim().slice(0, 900) || undefined,
    });
  };

  // Prefer official-source-rich Firecrawl discovery when both return quickly,
  // then fill remaining capacity from OpenRouter's current web-search tool.
  for (const item of firecrawlResult) add(item);
  for (const item of openRouterResult) add(item);
  return sources;
}

async function enrichAuthoritySourcesWithCrawlerPool(
  sources: LexaraAuthoritySource[],
  selectedCrawlerIds: string[],
): Promise<LexaraAuthoritySource[]> {
  if (!sources.length) return sources;
  const usePantheon = selectedCrawlerIds.some(id =>
    ['startrek', 'birdofprey', 'sixdegrees', 'blizzard', 'cerberus', 'lich'].includes(id)
  );
  if (!usePantheon) return sources;

  // Discovery providers often already return enough primary-source text.
  // Only pay crawler-enrichment latency for sources that still lack evidence.
  const targets = sources.filter(source => !source.excerpt?.trim()).slice(0, 2).map(source => source.url);
  if (!targets.length) return sources;

  try {
    const enrichment = await Promise.race([
      pantheonRetrievalAdapter.retrieve({
        purpose: 'lexara_legal_research',
        targets,
        depth: 2,
      }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), CRAWLER_ENRICHMENT_TIMEOUT_MS)),
    ]);
    if (!enrichment?.evidence?.length) return sources;

    const byTarget = new Map(
      enrichment.evidence
        .filter(item => item.content?.trim())
        .map(item => [item.target, item.content.trim().slice(0, 900)]),
    );
    return sources.map(source => ({
      ...source,
      excerpt: source.excerpt || byTarget.get(source.url) || undefined,
    }));
  } catch (error) {
    console.warn('[LEXARA Authority] Crawler enrichment failed route-locally', {
      error: error instanceof Error ? error.message : String(error),
    });
    return sources;
  }
}

export function shouldResearchLegalAuthority(
  prompt: string,
  context: LexaraAuthorityResearchContext = {},
): boolean {
  if (process.env.LEXARA_GROUNDED_LEGAL_RESEARCH === 'false') return false;
  const text = prompt.trim();
  if (!text) return false;
  if (AUTHORITY_SENSITIVE_PATTERN.test(text)) return true;
  return !!context.jurisdiction && HIGH_CONSEQUENCE_PATTERN.test(text);
}

export async function researchLegalAuthority(
  prompt: string,
  context: LexaraAuthorityResearchContext = {},
): Promise<LexaraAuthorityResearch | null> {
  if (!shouldResearchLegalAuthority(prompt, context)) return null;

  const legalQuestion = clampTail(prompt, MAX_RESEARCH_PROMPT_CHARACTERS);
  const jurisdiction = context.jurisdiction || 'jurisdiction not yet established';
  const domain = context.domainName || 'relevant legal domain';
  const currentDate = new Date().toISOString().slice(0, 10);
  const query = [
    `Current law as of ${currentDate}.`,
    `Jurisdiction: ${jurisdiction}.`,