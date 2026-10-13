# Spectra keyless provider connections

OpenSERP, SearXNG and DDGS were already connected through `LegalProviderMesh`.
The Spectra-only composition now adds Firecrawl Keyless search, Jina Reader
for sparse successful HTML pages, and Crawl4AI for local HTML-to-Markdown
extraction. Shared Lexara's retired Firecrawl policy is unchanged.

## Runtime wiring

Both Spectra discovery entry paths use the same composition. Native leads
survive alternate-provider failure, URLs are deduplicated, and first-useful
acquisition cancels slower work. Direct retrieval remains responsible for
public URL validation, redirects, content types and byte limits. Readers are
invoked only after successful HTML retrieval, never to retry an access denial,
CAPTCHA or authentication page. Publication times and observations remain
unchanged; text provenance is archived separately.

Crawl4AI runs as a bounded subprocess inside **Bad-Blue**, not another Railway
service. Docker installs the pinned Python 3.11 dependency set, sets
`SPECTRA_CRAWL4AI_PYTHON=/opt/spectra-crawl4ai/bin/python`, and enables it. The
extractor receives already-fetched HTML over stdin and returns Markdown over
stdout. It does not start a browser, listen on a port, fetch URLs or use a cloud
account/LLM. The image build exercises its real extraction protocol as appuser.
This integration uses Crawl4AI's extraction capability, not its browser crawler.

Firecrawl and Jina default to anonymous access; no existing keys are read.
`SPECTRA_FIRECRAWL_ENABLED=false`, `SPECTRA_JINA_ENABLED=false`, or
`SPECTRA_CRAWL4AI_ENABLED=false` disables the corresponding lane explicitly.

Each lane admits at most two concurrent calls without a queue. Process-local
minute limits are 6 for Firecrawl and 18 for each reader. Anonymous provider
limits may be stricter and are shared across an IP; these local bounds are not
an account quota guarantee. HTTP 429 pauses that lane for 24 hours; 401/402/403
pause it for an hour. No retry or identity rotation occurs. Remote requests
have an 8-second maximum; local extraction has 3 seconds. The existing
15-second pass budget bounds the combined search/read phase: faster searches
leave up to 8 seconds for reading, slower searches leave less. Bodies and
subprocess output are capped at 2 MB; retained text is capped at 320,000 chars.

Deployment preflight now reports all three new providers, with fixed status
labels only. Explicitly disabled/unconfigured lanes are not marked healthy.
Existing keyed provider failures remain visible; adding these providers does
not repair a Tavily credit balance or ScrapingBee account.

## Reviewed blueprints

Checked before implementation and against the adapters/tests afterward:

- [Firecrawl search contract](https://docs.firecrawl.dev/features/search):
  anonymous POST `/v2/search`; the adapter parses `data.web`, not legacy arrays.
- [Firecrawl rate limits](https://docs.firecrawl.dev/rate-limits): anonymous
  requests and credits are limited per IP/day; no invented monthly allowance.
- [Jina Reader repository](https://github.com/jina-ai/reader) and
  [rate limits](https://jina.ai/en-US/api-dashboard/rate-limit/): JSON response
  negotiation and reader headers; anonymous Reader is limited to 20 RPM.
  Key-required `s.jina.ai` search is not used.
- [Crawl4AI 0.9.4 source](https://github.com/unclecode/crawl4ai/tree/v0.9.4),
  [Markdown generation](https://docs.crawl4ai.com/core/markdown-generation/),
  [release package](https://pypi.org/project/Crawl4AI/0.9.4/): verified
  `DefaultMarkdownGenerator.generate_markdown(input_html, base_url, citations)`.
- [OpenSERP](https://github.com/karust/openserp),
  [SearXNG search API](https://docs.searxng.org/dev/search_api.html), and
  [DDGS](https://github.com/deedy5/ddgs): preserve existing self-hosted lanes.

## Verification and release status

Live, non-personal fixture checks returned Firecrawl search results and Jina
Reader content. The actual adapters returned 5 search results and Reader text;
Crawl4AI 0.9.4 extracted real Markdown locally. These are workspace checks, not
proof of connectivity from Railway. The actual container remains to be built.

Provider regressions cover malformed/oversized responses, denied access,
quotas, cancellation, concurrency, secret-free requests/diagnostics, source
identity, native partial results, first-useful cancellation, direct-denial
short circuit, provenance, and real local extraction. The three-group release
runner requires Node 20 and the configured Crawl4AI runtime. This workspace
has Node 24; its release run stops at that guard. CI must pass all three groups
before merge and deployment to adaptable-youth / production / Bad-Blue.
