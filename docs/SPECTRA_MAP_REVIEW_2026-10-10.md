# Spectra map repair and live QA — October 10, 2026

## What this patch changes

- Starts satellite/hybrid mode with an inline NASA GIBS Blue Marble style. The first map no longer depends on an external vector style, acquisition output, or supplied coordinates.
- Uses the same NASA default in Leaflet, with the correct Web Mercator tile matrix, 256 px tiles, zoom ceiling 8, attribution and August 2004 composite label. NASA Worldview uses GIBS; this integrates its imagery service rather than embedding Worldview's application.
- Restores terrain and buildings by default in the Spectra shell. A separate OpenFreeMap building source preserves 3D extrusions with the inline NASA style. Building-source failure leaves the basemap available.
- Recovers from constructor failures, asynchronous style errors, stalled startup/style changes, and a lost WebGL context that does not recover within 10 seconds. Unmount and recovery cancel timers and release the failed map.
- Bounds raster startup with NASA → Esri → OpenStreetMap fallback and a visible unavailable state when no imagery succeeds. Overlays retain their drawing order during fallback.
- Corrects the UI counter from “evidence sources reviewed” to “source groups referenced.” The existing sourceCount is not a count of successfully downloaded, independently verified sources.

This patch changes map rendering, map diagnostics and UI wording. It does not change identity matching, location inference, source acquisition, account permissions or device telemetry collection.

## Confirmed regression and route review

Commit `529bd196f5626c96205ea798cf8ee950a4ff63bd` changed the dashboard's terrain and buildings defaults from true to false while adding the Leaflet fallback. The older `819f5f171188672a6600474014fa65471cabc53c` dashboard also started the Spectra shell in hybrid mode with terrain/buildings enabled. This patch restores those Spectra defaults without removing fallback support.

At reviewed baseline `3d318975b023d2d23f522727d80f1167ffc86484`, App.tsx routes both `/people-finder` and `/spectra` to SpectraPage. The older people-finder page and PeopleFinderSearch component remain in the tree, but their filenames do not establish an active duplicate map. They were not deleted or rewired.

3D here means the existing MapLibre terrain and building extrusions. A browser unable to initialize WebGL still requires the explicitly labeled 2D fallback. This review does not claim to have verified 3D rendering on the user's phone.

## Live production tests before this patch

Live deployment: `1c584c17-26aa-4a0c-9770-8ebed67cfae4`, commit `8ab5ddc39a1e208cca77cfbe6abbf7fefb9218fd`.

| Test | Input | Acquisition response | Visible result |
| --- | --- | --- | --- |
| Public museum | Smithsonian National Air and Space Museum; public-museum context, no starting coordinates | HTTP 200, 28.951 seconds, 17:18:10 UTC | 23 “evidence sources reviewed”; no mappable estimate |
| Authorized blind self-test | User-supplied name, phone and email only; expected city/address withheld | HTTP 200, 34.288 seconds, 17:26:24 UTC | 23 “evidence sources reviewed”; no mappable estimate; report said no location data for session |

The desktop browser displayed the existing Esri map through Leaflet. The blank map shown in the user's phone screenshot was not reproduced in this browser. No application map error was captured by the old version; Chrome-extension errors were excluded from the diagnosis.

The following counts come from unfiltered, bounded runtime windows split below the log limit. Shared search logs have no per-acquisition identifier; counts describe the test windows, not proven exclusive attribution to one request.

| Failure | Museum window, 17:17:40–17:18:12 UTC | Self-test window, 17:25:49–17:26:26 UTC |
| --- | ---: | ---: |
| SearXNG ENOTFOUND | 142 | 152 |
| DDGS backend ENOTFOUND | 142 | 152 |
| OpenSERP ENOTFOUND | 142 | 152 |
| Tavily timeout | 30 | 17 |
| SerpAPI timeout | 3 | 4 |
| ScrapingBee HTTP 400 | 3 | 4 |
| DuckDuckGo response JSON parse failure | 7 | 26 |
| Common Crawl HTTP 503 | 3 | 0 |
| Common Crawl socket error | 0 | 5 |
| AbortSignal MaxListeners warnings | 4 | 5 |

The windows contained 673 and 690 runtime entries respectively, retrieved in two bounded reads each. Discovery summaries still described failed lanes as fulfilled with zero candidates. Geocoder logs showed unresolved clues. This is evidence of acquisition/dependency failures and misleading health reporting; it does not establish an inference-engine crash or the expected location.

## Remaining gaps

1. Diagnose the three unavailable search services and correct provider outcome reporting before treating source counts as retrieval coverage. Avoid repeatedly spending the request budget on a known unavailable provider. This patch does not repair or expand personal-data acquisition.
2. Separate discovery, successful retrieval, rejected evidence and accepted observations in diagnostics. Preserve provider-specific failure reasons and correlate them with an acquisition ID. A successful HTTP response is not a successful location identification.
3. Review telemetry connection status independently of parser availability. SpectraAdapterRegistry marks many provider-webhook adapters configured from the presence of one HMAC secret; that does not prove any device or account is sending data. Login activity, email usage, cellular, Wi-Fi and Bluetooth telemetry are not public merely because a user initiates a query.
4. Historical photo metadata or a place mentioned by a source does not prove a person's current position. Preserve existing provenance, identity-binding, timestamp and uncertainty checks. The blind self-test's expected answer was never added to inputs, fixtures, code or source queries.
5. Validate the production build and the resulting deployment on a WebGL-capable desktop and the affected mobile browser. Check initial NASA imagery, pitch/rotate, 3D terrain, building visibility at an appropriate zoom, fullscreen/resize, dark/street style changes, and offline tile failure. Verify the image label still distinguishes a composite from current imagery.

## Validation completed

- 15 component lifecycle tests using actual React components and mocked map drivers: no starting target, stalled startup, asynchronous style error, no WebGL, successful startup, unrecovered/recovered context loss, style-switch timeout and successful overlay restoration before all tiles load, satellite fallback metadata, NASA with 3D terrain/buildings, NASA fallback for a 3D request, successful raster load, exhausted providers, and tile-error cleanup.
- Shared basemap/deadline test passed: tile coordinate order, native zoom, historical label, custom attribution, cancellation and rearming.
- Isolated TypeScript check of both map components and the helper passed with installed React/Leaflet/MapLibre types and fixtures for the unchanged application frame types. This is not a full repository type check.
- esbuild compilation of the changed map modules passed; MapLibre's style validator accepted the inline NASA style.
- Live NASA GetCapabilities confirmed BlueMarble_NextGeneration, GoogleMapsCompatible_Level8 and image/jpeg. A representative zoom-0 tile returned HTTP 200, image/jpeg, 256 × 256 pixels.
- `git diff --check` passed.
- No GitHub Actions were dispatched. Full application build and post-deployment browser QA remain outstanding; this is a draft patch, not a completed production release.

Run the lightweight test using the repository's existing tsx dependency:

```sh
node --import tsx scripts/verify-spectra-map-basemap.ts
```

The manual lifecycle harness uses optional isolated test tools, avoiding changes to the application's lockfile:

```sh
npm install --prefix /tmp/spectra-map-qa --ignore-scripts --no-audit --no-fund react@18.3.1 react-test-renderer@18.3.1 @sinonjs/fake-timers@13.0.5 esbuild@0.25.0
SPECTRA_MAP_TEST_TOOLS=/tmp/spectra-map-qa node scripts/verify-spectra-map-runtime.cjs
```

These tests exercise lifecycle and configuration behavior. They do not measure source coverage, real-world location accuracy, GPU rendering or mobile performance.

## Primary implementation references

- NASA GIBS API mapping-library guidance: https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/
- NASA's reviewed Leaflet and Mapbox GL examples (Apache-2.0): https://github.com/nasa-gibs/gibs-web-examples/tree/main/examples
- NASA Worldview's Blue Marble metadata: https://github.com/nasa-gibs/worldview/blob/main/config/default/common/config/metadata/layers/reference/blue_marble/BlueMarble_NextGeneration.md
- Live GIBS Web Mercator capabilities: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- MapLibre raster-style example: https://maplibre.org/maplibre-gl-js/docs/examples/display-a-satellite-map/
- MapLibre's independent OpenFreeMap building-source example: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/

## Release state

Changes are based on `3d318975b023d2d23f522727d80f1167ffc86484`. This preserves the branch's existing SEO and four later fixes.

During review, Railway already had patch `3e661274-e535-445a-b2b6-385980196ee5` staged to advance production from `8ab5ddc` to SEO commit `83f48d4`. It was not created, accepted, replaced or deployed by this map repair. Reconcile that pending release before promoting this branch.

## Batched follow-up: feed diagnostics and build compatibility

After explicit deployment approval, the reviewed branch replaced the pending source release while preserving its changes. Deployment `537ca147-fdc0-4b15-b2d7-2df20983b9e5` failed during the production invariant checks on October 10 at 18:07 UTC. The attribution check still expected the Esri credit inside the renderer; it now lives in the shared basemap helper. A second static check expected an inline style callback even though the permanent named callback restores the same overlays and handles cleanup. Both checks now follow the implemented structure; the existing requirements remain enforced. An additional lifecycle check verifies style restoration while tiles are still loading.

The same follow-up batch adds request-scoped discovery diagnostics using Node AsyncLocalStorage:

- Distinguishes successful requests with candidates, empty results, connection failures, timeouts, caller cancellation, skipped requests and pending work.
- Uses a generated request ID to correlate the authenticated acquisition response with provider logs. Concurrent requests retain separate counters. Snapshots do not change after being returned.
- Classifies DNS, connection, HTTP and malformed-response failures without logging raw queries, URLs, credentials or exception text in the new diagnostic payloads.
- Labels Promise completion as Promise completion rather than provider health. Search return values, provider selection, retries, budgets, identity matching and location inference are unchanged.
- Shows an incomplete-coverage notice when feed diagnostics report failures or unfinished checks. A search error no longer blames missing target information.

This reporting covers the instrumented discovery HTTP lanes only. It is not a count of retrieved documents, verified facts, all adapters, or connected accounts. An empty response is not proof that no public evidence exists. A configured parser is not proof that a feed is connected.

Read-only Railway inspection confirmed that `lexara-ddgs` and `lexara-openserp` have failed deployments; `lexara-searxng` has no deployment. The DDGS build completed, but all `/health` probes failed and its replica never became healthy. These backing services were not redeployed or reconfigured by this batch. It does not claim their data feeds have been restored, and it does not add private account/device collection or expand person-location acquisition.

Validation: nine offline diagnostic checks exercise the actual request wrapper, error classification, return-value preservation, timeout versus cancellation, concurrent-request isolation, pending snapshots, redaction, and client notices. The 35 production invariants, 134 Spectra static checks, client-control checks, and 15 map lifecycle checks pass locally. The diagnostic and shared-basemap checks are included in `verify:spectra` for subsequent builds. Full production build and live browser verification are still required for the replacement release.

Primary diagnostic references: https://nodejs.org/api/async_context.html and https://opentelemetry.io/docs/specs/semconv/general/recording-errors/ . The implementation uses bounded error categories and per-request context; it does not add an OpenTelemetry exporter or external log destination.

## Configuration and release-test corrections

Read-only Railway inspection on October 10 found deployment `723c1121-fa5d-4d8d-8e97-85b520a05374` (commit `724a011`) failed. Its build log identified a strict VM test loader rejecting the new `./DiscoveryDiagnostics` dependency. The application remained online on the earlier successful deployment `1c584c17-26aa-4a0c-9770-8ebed67cfae4`. DDGS, OpenSERP, and SearXNG remained offline.

The next batch corrects the test harness without weakening its dependency allowlist or removing assertions. It loads the real diagnostic module, supplies the standard performance clock to both affected VM contexts, and supplies the existing pure retrieval-selection/provenance helpers to the isolated route test. The native background suite and all 31 research-routing checks then pass with external I/O mocked.

Configuration reporting now separates adapter prerequisites, connection testing, and observation availability. In particular, a webhook credential means ingestion authentication is configured; it does not establish a connected upstream feed. The authenticated capabilities response includes an explicit configuration-only credential inventory for nine reviewed provider groups. It returns fixed variable names and presence flags, never values, endpoints, or unrelated environment variables. Authentication and connection status remain untested until runtime evidence exists. This is not a complete inventory of all application keys or dynamically configured provider headers.

The existing Google radio credential selector now ignores whitespace-only higher-priority variables before checking its existing fallbacks. Its configured flag, the OpenCellID flag, and the webhook flag also reject blank values. No provider, key alias, data-collection method, source-selection rule, or inference algorithm is added.

Railway listed `TAVILY_API_KEY`, `SERPAPI_KEY`, `SCRAPINGBEE_API_KEY`, `GEONAMES_USERNAME`, and the three search-service URL variables. It also listed the newly added `CENSUS_API_KEY`. Values were not inspected or changed, and presence is not a validation of credentials. The Census Geocoder does not use the Census Data API key; the diagnostic response states that explicitly.

Eight new offline checks cover blank values, existing key aliases and precedence, multi-part configuration, Census key semantics, secret-value omission, real registry status semantics, and the actual authenticated capability handler. All pass. Nine feed-diagnostic checks, 15 map lifecycle checks, 35 production invariants, 134 Spectra static checks, and client-control checks also pass. Changed server TypeScript compiles with esbuild; this is a syntax check, not a full application type check. The configuration suite is included in `verify:spectra`.

All tests use synthetic fixtures and mocked external I/O. No personal location test was run in this batch. Full Railway build and browser verification remain required before calling the release live. No GitHub Actions or Railway AI agent is used. Any commit for this batch includes `[skip ci]`.

## Live verification after the successful b107ac99 release

Railway deployment `02fa4944-f250-4938-95ec-81abf09b299a` reached SUCCESS for commit `b107ac99b451417c15c87ab9224f4474baeea69d`. Production readiness returned HTTP 200 at 19:09:08 UTC on October 10. The full production build passed the previously failing verification gates.

The live authenticated Spectra page displayed NASA Blue Marble before any target was entered. Street/satellite switching and fullscreen/restore worked. All 24 visible raster tile images finished loading after the style transition. This browser used the explicitly labeled 2D fallback. Actual 3D GPU rendering and the affected mobile browser remain unverified. A direct browser navigation to the authenticated capability endpoint was blocked by the browser client, so its live JSON payload was not verified through that route.

The user-authorized blind self-test used only the supplied name, phone, and email, with the expected location withheld. A first submission was not executed because automatic approval review hit a usage limit. After the user requested continuation, the same normal review path allowed submission. The completed acquisition returned HTTP 200 in 41,882 ms at 19:16:51 UTC, reported 28 source groups referenced, displayed the incomplete-coverage notice, and produced no mappable location estimate. No third-party-person test was run.

Request-correlated diagnostics (`472220f5-50a0-48f6-bde8-768d2310e9c1`) recorded 837 discovery HTTP attempts: 8 with candidates, 135 empty, 531 failed, and 163 timed out. These are request outcomes, not counts of independent sources or verified evidence. No requests remained pending in the final snapshot.

| Provider | Candidate-bearing responses | Empty | Failed | Timed out | Classified failure |
| --- | ---: | ---: | ---: | ---: | --- |
| Tavily | 7 | 0 | 0 | 157 | timeout |
| DuckDuckGo Instant Answer | 0 | 134 | 30 | 0 | invalid response |
| SearXNG | 0 | 0 | 164 | 0 | DNS |
| DDGS | 0 | 0 | 164 | 0 | DNS |
| OpenSERP | 0 | 0 | 164 | 0 | DNS |
| Common Crawl | 0 | 1 | 4 | 1 | HTTP 503; timeout |
| SerpAPI | 1 | 0 | 0 | 5 | timeout |
| ScrapingBee | 0 | 0 | 5 | 0 | HTTP 400 |

The result confirms severe feed failures and repeated requests to unavailable services. It does not demonstrate an inference-engine crash or validate any current location. The requested location-identification goal remains unmet.

Live QA also reproduced stale provider credits after changing map styles. The raster cleanup removed every event listener before removing a layer, suppressing Leaflet's own `remove` listener that releases attribution. The follow-up removes the layer first, then clears callbacks. Two lifecycle regression cases cover both style changes and provider fallback; the style-change case failed before the fix with stale NASA/Esri credits, matching the browser observation. Map diagnostic events are serialized so browser console capture retains the fallback reason instead of only `Object`.

The same follow-up changes the progress labels to `Search progress`, `Target description received`, and `Phone clue supplied`. A supplied phone number is input, not proof of an observed device or established location. Provider selection, source acquisition, inference, permissions, and device collection are unchanged.
