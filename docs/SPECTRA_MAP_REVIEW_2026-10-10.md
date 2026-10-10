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
