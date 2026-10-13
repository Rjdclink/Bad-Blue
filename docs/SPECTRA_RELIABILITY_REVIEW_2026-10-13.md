# Spectra reliability review — 2026-10-13

Scope: `Rjdclink/Bad-Blue`, based on develop `842a4f383104b94fba0aa62b4c3befbc62adbda3`; Railway adaptable-youth / production / Bad-Blue. This review separates code verification, observed production behavior, and unresolved deployment/provider dependencies. It does not establish complete real-world coverage or guaranteed location accuracy.

## Corrections

| Defect | Change | Verification |
| --- | --- | --- |
| API access logging serialized Spectra response bodies and exposed session IDs | Exclude response bodies; allowlist route labels and redact session IDs | Execute the real middleware with a synthetic response that throws if serialized |
| Failed session restoration looked like empty history | Propagate missing-schema/read errors and return a safe 503 before beginning a replacement acquisition | Inject database errors and distinguish them from valid empty results |
| Replaced requests continued in the browser | Abort replaced/reset/unmounted requests and ignore stale results | Execute acquisition and unmount handlers with controlled pending requests |
| Older records disappeared past the 500-row display window | Advance a bounded historical window, pause live refresh, and provide return-to-newest control | Load another page after 500 records; verify older rows remain accessible |
| Text retrieval buffered an entire response before checking a character limit | Enforce a decoded byte budget while reading, cancel unused bodies | Synthetic multibyte stream exceeds budget and is cancelled early |
| EXIF west/south direction depended on human-readable descriptions | Use raw EXIF reference values for coordinate arithmetic | Existing synthetic binary EXIF fixture passes with installed decoder |
| Public-event feeds waited for each other | Two workers process independent due feeds; leases, provider cadence and backoff remain enforced | Overlapping synthetic fetches; cancellation releases leases; HTTP holds no database transaction |
| Regression harnesses did not match current dependencies | Load the pipeline deduplication helper; correct image fixtures; verify the existing cancellable gas-authority wrapper | Full Spectra suite and the unchanged authority requirement pass |

The gas-authority change is limited to an outdated build assertion. It does not change financial runtime behavior or remove the funding-proof check.

## Production observations

- Bad-Blue remains on successful deployment `880b7a7a-44d4-4346-bff8-ea257ac07b0f`, commit `a0742ad4f5a8e7b0d5f31bb95ea90da211a06a94`. Newer failed builds have not replaced it.
- The earlier “30 collections” meant 30 log entries in a time window, not a cap on collected evidence. Between 12:00 and 13:25 UTC, the reviewed logs contained 37 successful public-feed collections. Individual batches held roughly 216–224 earthquake records, 229–270 weather alerts, and 71 EONET records. These are overlapping snapshots, not additive unique-record counts or person-location observations.
- The latest acquisition reviewed at 11:27 UTC took about 38 seconds: 32 discovery results, 40 page selections, 19 retrieved, 21 not retrieved. Failures included unsupported content, 403 and 429. It had no active telemetry observations and produced regional context, not a verified current position.
- OpenSERP, DDGS and SearXNG were offline at review. OpenSERP's last failed process reported an invalid IPv6 bind address; current checked-in configuration uses IPv4. DDGS's last failed image predates the checked-in custom health/listener launcher. SearXNG has no deployment history. These fixes require a fresh build and runtime verification; a healthy container alone will not prove successful upstream search.
- Earlier provider results included Tavily HTTP 432 (plan limit), ScrapingBee HTTP 401, private-network DNS failures and partial/time-limited providers. No recovery has been established.
- A targeted production-log search for missing-schema, read-failure and persistence-unavailable messages returned none in the reviewed interval. Public-feed writes were succeeding. The restoration fix addresses a demonstrated code defect under injected failures; it is not evidence that a current database outage was repaired. Production read/write round trips still need verification.

## Validation and deployment status

- `npm run verify:spectra`: passed on Node 20.20.2 after the final feed changes. Synthetic/mocked provider tests do not prove live providers work.
- `npm run build:server`: passed. The browser Vite build passed during the full build.
- `npm run build`: progressed through its verification gates and Vite, then failed in browser-asset preservation with `EAI_AGAIN legalwhat.com` in this execution environment. The preservation gate remains intact. A complete deployment build is still required.
- `git diff --check`: passed.
- A separate-provider deployment attempt was rejected by the deployment tool with “the user did not approve this action.” No provider deployment was performed. The user subsequently restricted deployment to Bad-Blue / production / adaptable-youth; source-reset changes for the separate providers are staged but not applied (patch `d146ac0d-d341-48d5-984d-51182d580a81`). The connector exposes no discard operation. This pending patch must be discarded before applying a Bad-Blue-only environment deployment. All three providers remain offline. No GitHub Actions changes are included.
- No merge, production acquisition against a person, credential rotation, subscription upgrade, or direct database mutation was performed.

## Remaining release requirements

1. Deploy only Bad-Blue / production / adaptable-youth once approved, observe terminal deployment success, then run the existing bounded `check-spectra-providers.cjs` from the private network. Separate provider services remain outside the permitted deployment scope. Its public NASA-documentation query checks actual search responses, not just health endpoints.
2. Resolve account authorization/quota failures using provider account controls. Preserve quotas and deadlines; do not increase collection simply to inflate counts. Timeouts and upstream refusals must remain explicit and recoverable.
3. Build and deploy the application patch, validate readiness, confirm authenticated persistence round trips with synthetic data, and verify UI pagination/cancellation in the deployed browser.
4. Confirm acquisition completeness against the actual persisted source records. The pagination correction does not promise unlimited collection; explicit omissions, source limits, retention and access boundaries remain.
5. Browser cancellation currently stops client requests; it does not guarantee every server-side upstream task cancels on disconnect. Provider-wide quota coordination and recovery remain separate unverified work.

## Primary-source references

| Reference | Application |
| --- | --- |
| [Node Web Streams](https://nodejs.org/api/webstreams.html), [Buffer](https://nodejs.org/api/buffer.html) | Byte-bounded reads, cancellation and decoding |
| [React effect synchronization](https://react.dev/learn/synchronizing-with-effects) | Cleanup and stale-response protection |
| [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | Exclude sensitive payloads/session identifiers from routine logs |
| [ExifReader](https://github.com/mattiasw/ExifReader) | Raw values for computations; descriptions are display strings |
| [Railway private networking](https://docs.railway.com/networking/private-networking) | Verify service deployment and private-network reachability |
| [Tavily error codes](https://help.tavily.com/articles/8645538886-understanding-http-errors) | Distinguish plan exhaustion from request-rate throttling |
| [NWS API](https://www.weather.gov/documentation/services-web-api), [USGS feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Cache-friendly bounded public-event collection; no arbitrary volume target |
