# Spectra acquisition follow-up — 2026-10-13

This follow-up supersedes the deployment-status statements in the earlier review. The first patch reached SUCCESS on Bad-Blue production at 14:04 UTC (deployment e746f700-4225-44fc-86e0-35028babf452). The separate search services are offline again. Only Bad-Blue may be deployed for this work.

## Code changes

- Acquisition lifetime now propagates through explicit HTTP transport wrappers, model request signals, discovery admission, public records, images, satellite context, telemetry adapters, camera adapters and geocoding. Disconnect, response completion, and the bounded request deadline cancel remaining network work. Ordinary request-body completion does not cancel the response. Concurrent requests have separate cancellation scopes.
- Cancelled work cannot start subsequent HTTP requests or begin saving an acquisition. An already-started database transaction is allowed to finish atomically; it is not interrupted halfway through its writes.
- Existing provider-specific deadlines remain enforced. An individual provider deadline does not cancel independent providers. A 180-second overall request bound prevents abandoned acquisitions from running indefinitely.
- Quota statuses 429, 432 and 433 establish cooldown before reading an optional response body. Authentication/quota error bodies are cancelled immediately. Other error bodies are bounded to 2,000 bytes. Retry-After is honored, including dates; account-budget cooldown is at least six hours.
- After a failed provider's cooldown expires, only one recovery request is admitted until it succeeds. Success restores ordinary bounded parallelism. No CAPTCHA bypass or quota bypass was added.

The changes preserve the staged Lexara research guard and verifier from commit 4f88999bf342a066c6ed02a56f2bcc28995c4647. No GitHub Actions configuration was changed.

## Verification and operational requirements

Local verification exercises disconnect isolation, cancellation propagation, cleanup, prevention of later dispatch/persistence, all three quota statuses with stalled bodies, Retry-After recovery, and a single recovery probe. Provider tests use fixtures; they do not consume production credits or investigate people.

The latest observed production smoke check reported:

| Dependency | Observed condition | Required resolution |
| --- | --- | --- |
| Database schema | All eight runtime tables present | No missing-table migration was needed |
| USGS, NWS, EONET | Successful persisted collections | Continue normal provider cadence |
| DDGS, SearXNG, OpenSERP | Private DNS unavailable; services offline | Bring those services online or supply working provider endpoints; deploying only Bad-Blue cannot start separate services |
| Tavily | HTTP 432 | Restore available account budget; application cooldown cannot replenish it |
| ScrapingBee | HTTP 401 | Resolve invalid key or exhausted credits; Bearer authentication already matches current documentation |
| SerpAPI | Smoke request exceeded its deadline | Verify account and provider response health; no successful recovery was observed |

These are remaining operational blockers, not claims of completed end-to-end production functionality. No code can guarantee zero network timeouts, create unavailable provider credits, or retrieve evidence a source has refused to supply. UI results must retain these distinctions and bounded omissions. The user owns production acceptance testing.

## References used

- [Node AsyncLocalStorage](https://nodejs.org/api/async_context.html): preserve request scope across async work.
- [Node AbortSignal](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals): compose parent and provider cancellation; supported by the deployed Node 20 version.
- [Tavily error codes](https://help.tavily.com/articles/8645538886-understanding-http-errors): distinguish 429 throttling, 432 plan budget and 433 pay-as-you-go budget.
- [ScrapingBee documentation](https://www.scrapingbee.com/documentation/): Bearer authentication is correct; 401 can indicate an invalid key or exhausted credits.
