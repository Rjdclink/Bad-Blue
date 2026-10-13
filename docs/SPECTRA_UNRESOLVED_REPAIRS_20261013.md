# Spectra unresolved repair review — 2026-10-13

## Scope and baseline

Reviewed recent open and closed-unmerged Spectra PRs against develop `42a5255e3ba48b6f82d185e594b7188dbdbc6a84` and Railway's deployed `8006327ea3e94f8cfe4004ae6d4aa29d3d93d289`.
The new branch starts at that deployed commit, preserving the unmerged #1336 reliability work and the merged Lexara changes it already includes.

| Prior work | Disposition |
| --- | --- |
| #1279 | Restore publication/observation timestamp separation and behavioral coverage. |
| #1289 | EXIF hemisphere decoding already repaired; exclude date-shaped input from phone detection. |
| #1335 | Integrate credit admission, bounded text formats, and fixed-category provider/collector/format diagnostics. Rewrite shared usage cancellation and reservation accounting. |
| #1338 | Integrate own-property category guards and sanitized count decisions. Preserve the deployed JPEG test repair. |
| #1285, #1287, #1280 | Existing geotag, pipeline helper, and later street-map decisions already cover these; do not revive superseded map behavior. |

## Research and implementation blueprint

Research expanded from PR diffs and deployed behavior to each provider's documentation, API schema, implementation repository, and adjacent lifecycle contracts. Reviewed these contracts before implementation and checked the resulting behavior against them afterward. References are blueprints, not copied application code or a claim of exhaustive internet coverage.

| Source | Contract applied | Regression evidence |
| --- | --- | --- |
| [Tavily usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage), [OpenAPI](https://docs.tavily.com/documentation/api-reference/openapi.json), [search](https://docs.tavily.com/documentation/api-reference/endpoint/search), [rate limits](https://docs.tavily.com/documentation/rate-limits), [credits](https://docs.tavily.com/documentation/api-credits) | Verify nonnegative integer usage and both key/account limits; explicitly basic search with automatic parameters disabled; honor provider denial. | Budget concurrency, cancellation, malformed counters, stale snapshots, rotation, rolling rate, and actual adapter no-search assertions. |
| [tavily-ai/tavily-js](https://github.com/tavily-ai/tavily-js), `src/search.ts` blob `858ca8114b59545bb7be61cc7189736d5a72baf8` | Cross-check official request serialization. | Actual serialized basic search request checked. |
| [Schema.org datePublished](https://schema.org/datePublished), [uploadDate](https://schema.org/uploadDate) | Document publication/upload dates are not observation timestamps. | Publication metadata remains available; observation timestamp absent unless explicitly supplied in geo metadata. |
| [google/libphonenumber PhoneNumberMatcher](https://github.com/google/libphonenumber/blob/master/java/libphonenumber/src/com/google/i18n/phonenumbers/PhoneNumberMatcher.java) | Reject date/timestamp shapes before considering phone candidates. | Real shared helper and route parser: ISO, EXIF, slash dates, offsets and legitimate subsequent phone. |
| [nodejs/undici](https://github.com/nodejs/undici) | Consume/cancel bodies; avoid unbounded buffered retrieval. | Existing streaming byte limits and cancellation retained for newly supported text/plain, text/csv, text/markdown. |
| [searxng/searxng webapp](https://github.com/searxng/searxng/blob/master/searx/webapp.py), [exceptions](https://docs.searxng.org/src/searx.exceptions.html) | Engine failures can accompany useful results; preserve partial coverage and cooldowns. | Actual adapter partial-response and failure tests retained. |
| [ScrapingBee Google search](https://www.scrapingbee.com/features/google/), [documentation](https://www.scrapingbee.com/documentation/) | Existing endpoint and credential wiring match documentation; external account rejection is not fixed by rewriting transport. | Credential-free diagnostics and HTTP failure/cooldown tests. |
| [MDN own properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn) | Inherited object names cannot become diagnostic labels. Use ES2021-compatible hasOwnProperty.call for this repository. | Prototype-name fixtures and fixed-label sanitization. |

## Operational limits

The last pre-change live smoke showed Tavily HTTP 432, ScrapingBee HTTP 401 and SearXNG partial coverage. DDGS, OpenSERP and SerpAPI returned results. New code reports and respects these states; it cannot repair provider credentials, buy credits or guarantee upstream availability.

Tavily admission is process-local. It conservatively retains usage high-water marks so stale snapshots cannot restore spent reservations. A billing-cycle usage decrease requires a process reset because the documented response has no renewal epoch. This is not distributed accounting or a replacement for provider limits. Cancelled/failed search reservations are not refunded locally. Shared usage requests survive individual cancellation and abort when no caller remains.

Tests use fixed local fixtures, not personal searches. A passing build and mocked regressions do not prove every production workflow or all third-party accounts healthy.

## Release verification

Run `bash scripts/verify-spectra-release.sh` with Node 20. It performs three sequential groups on one unchanged tree and stops on any failure. After any fix, restart the script at group one; never resume at a later group. Record the final run and commit in the PR.

1. Focused strict types and behavioral repairs, including budget, parser, timestamp, retrieval, diagnostics and provider runtime/smoke.
2. Complete Spectra suite plus shared Lexara routing and native background regressions.
3. Full production `npm run build`, including all existing prebuild guards, browser assets and server/worker bundles, followed by whitespace validation.

Only after all three pass may this change merge. Deployment is restricted to Railway adaptable-youth / production / Bad-Blue, pinned to the merged commit. Verify the staged patch contains only that service before accepting it; inspect deployment status, readiness and provider smoke afterward.
