# Spectra repair review — October 13, 2026

The original unpushed local commit `49e8ba5` was lost during automated workspace
maintenance. This patch reconstructs the repairs on current `develop` (`842a4f3`)
and revalidates them. The earlier evidence-assessment syntax error is already fixed
upstream. No consent gate was added.

## Screenshot findings

| Finding | Repair or remaining dependency |
| --- | --- |
| Tavily HTTP 432 | Admit basic searches only after `/usage` establishes at least one credit. Atomically reserve each credit locally; skip exhausted or unknown budgets. Disable automatic depth selection. Apply 90 requests per rolling minute and cache usage checks for 65 seconds, including failures. Add HTTP 433 cooldown. Deployment smoke searches also require allowance. |
| SearXNG/DDGS/OpenSERP DNS failures | Explicit missing configuration, cooldown and challenge-disabled reasons. Existing outage suppression and bounded queues are tested. This code cannot repair a stopped upstream service. Earlier read-only inspection found failed DDGS/OpenSERP deployments and no current SearXNG deployment. Those services were not redeployed. |
| DuckDuckGo Instant Answer empty responses | Explain that this limited-answer API is not a full search index. Empty answers do not establish absence of web evidence. |
| Common Crawl/SerpAPI partial results, failures and timeouts | Preserve distinctions among empty, failed, timeout and partial results. Existing runtime regression checks now run in the standard Spectra gate. No claim of live upstream recovery. |
| ScrapingBee HTTP 401 | Explain authentication rejection and distinguish missing configuration. No new credential was supplied or tested. |
| Unsupported page formats | Accept bounded plain text, CSV and Markdown snapshots without inventing location observations. Normalize MIME essence; stream-limit decompressed bytes; cancel unused bodies; report fixed unsupported format categories. PDF/XML/binary decoding is not implemented. The screenshot's original rejected URLs/types are unavailable, so recovery of all 40 selections is not claimed. |
| Three skipped telemetry collectors | Preserve fixed modality, status, measurement counts and bounded reason codes for Android managed device, Apple supervised device, Cisco Spaces and other collectors. Raw identifiers/errors are not added to diagnostics. This does not create measurements or add biometric/satellite tracking capabilities. |

## Additional defects

Public-image EXIF hemisphere references used human-readable descriptions such as
“West longitude” instead of the raw `W` code, producing incorrect longitude signs.
Read and validate raw axis-specific reference codes. The real-decoder regression
passes; media coordinates remain capture-scene evidence.

Update stale fixtures to load the real discovery-dedup helper and use unsupported
GIF instead of supported JPEG. Add behavioral tests for budget concurrency,
unknown/exhausted allowance, delayed accounting, usage failures, cancellation,
rate limits, text formats, streaming byte limits, MIME handling and sanitized
collector/content-format summaries.

## Tavily boundaries

Admission is process-local, not a distributed account lock. Other consumers,
replicas, restarts and delayed provider accounting can still race. Account-wide
certainty requires coordinated admission for every consumer plus provider caps.
The implementation uses the tighter key/account allowance, including only already
configured pay-as-you-go credits; it does not enable or enlarge paid usage.
High-water local usage prevents stale snapshots from restoring spent credits and
charges ambiguous failures conservatively. It may under-use credits and does not
automatically recognize a monthly billing reset; a fresh process/key refreshes
from provider usage. Usage lookup consumes the existing request deadline.

## Verification after reconstruction

- Full `npm run verify:spectra`: passed on Node 20.20.2.
- Subsequent collector-reporting and smoke-budget fixture additions: passed.
- Focused strict TypeScript checks for budget, diagnostics, retrieval and active
  acquisition: passed after correcting literal inference for reason codes.
- Production server bundle and Vite client bundle: passed on Node 20.20.2.
  Existing client warnings remain.
- `git diff --check`: passed.
- Whole-repository TypeScript checking previously exhausted the default heap;
  it is not claimed passing. Full Docker build and live private-device accuracy
  testing were not performed.

## Production scope and blocker

Only `Bad-Blue` (`50136f51-cf5e-4a09-9bb3-92279c4f5c75`) in `production`
(`91154a53-01a3-470c-8fdc-c0f13b4702fa`) under `adaptable-youth`
(`51340040-15c4-4d74-b60e-8471bdcae20e`) is the authorized deployment target.
The service follows `Rjdclink/Bad-Blue` branch `develop`; no staged changes were
present on inspection.

Latest observed deployment `bd7468b8-e5d8-43b4-99cc-920293f281ba` failed on
October 13 at `scripts/cryptocrawl/verify-system-native-gas-spend-authority.cjs:96`:
“Canonical discovery must derive funding eligibility from current durable proof”.
The same gate fails locally on the restored branch. It concerns unchanged
CryptoCrawler financial execution code, outside these Spectra repairs. The gate
was not bypassed. Successful client/server bundling does not establish that the
full deployment can pass. No production deployment or configuration was changed.

## Primary-source blueprint

Research was expanded by observed issue, not claimed exhaustive of the internet.

- [Tavily usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage)
  and [rate limits](https://docs.tavily.com/documentation/rate-limits), rechecked
  during reconstruction; [credit costs](https://docs.tavily.com/documentation/api-credits)
  and [official integration](https://github.com/tavily-ai/tavily-n8n-node).
- [ScrapingBee Google API](https://www.scrapingbee.com/features/google/),
  [SerpAPI statuses](https://serpapi.com/api-status-and-error-codes),
  [DuckDuckGo API source](https://github.com/duckduckgo/duckduckgo-publisher/blob/master/share/site/duckduckgo/api.tx).
- [Common Crawl](https://index.commoncrawl.org/), [DDGS](https://github.com/deedy5/ddgs),
  [OpenSERP](https://github.com/karust/openserp),
  [SearXNG](https://docs.searxng.org/dev/search_api.html).
- [Undici](https://github.com/nodejs/undici), [MIME essence](https://mimesniff.spec.whatwg.org/),
  [ExifReader](https://github.com/mattiasw/ExifReader).
