# Spectra record collection and evidence retention

Reviewed 2026-10-10 America/Chicago (live HTTP checks at 2026-10-11 00:11 UTC).

This review covers Spectra discovery, retrieval, acquisition persistence, public-place acquisition, the evidence-record interface, and the new public-feed collection path. It is not a claim that every subsystem in the repository was audited.

## Findings and changes

Spectra already had working retrieval adapters; its source list was not entirely a directory of search links. `SpectraPublicRetrieval.ts` fetches selected public pages/JSON, and the existing context adapters fetch nearby places, weather observations, camera-directory records, geotagged media and Earth-observation catalog results. The missing behavior addressed here is durable, inspectable retention of that acquired content, plus recurring collection of independent public event records.

The general `/api/spectra/acquire` path retains successfully retrieved document content and returned geographic context through `SpectraAcquisitionRecords.ts` and `SpectraAcquisitionPersistence.ts`. The public-venue path retains the successfully fetched source documents too, including sources whose address assessment was rejected. A saved source is not automatically an accepted location observation. Search results without successful content retrieval remain discovery leads and do not become archived evidence merely because a search engine supplied a title, snippet or URL.

General acquisition continues to use the existing adaptive search policy in `SpectraSourceRegistry.ts`: at most **8 passes, 48 queries and 160 candidates**, with sufficiency and diminishing-return stops. Public-page retrieval has its own limits, including eight targets per call, a 2,000,000-byte response bound, three redirects and a 2.2-second request timeout. This is bounded recursive discovery, not an unending internet crawl, and candidates selected for discovery are not a promise that every page will be retrieved.

The new recurring feeds supply earthquake records, natural-event records and weather alerts. They do not require signup, a token, or production search credits. Their geometry describes an event or affected area. It is not a person's or device's current position, and the feed records are classified as `public_geographic_context` rather than admitted as target telemetry.

## What is saved

| Record family | Retained content | Provenance and limits |
| --- | --- | --- |
| General retrieved JSON | Complete parsed JSON when it fits the archival budget | Original/final URL where available, retrieval provider/time, content type, source publication time if supplied; oversized JSON is explicitly marked omitted |
| General retrieved HTML | Extracted source title/text excerpt, address blocks and explicit geospatial metadata | An extracted-document snapshot; not the complete original HTML, images, attachments or a browser screenshot |
| Existing geographic adapters | Returned normalized place, weather, camera-directory, geotagged-media or satellite-catalog record | Geographic context with `subjectMatchConfidence: 0` and `currentPositionVerified: false`; catalog metadata is not an image download and a camera-directory entry is not captured video |
| New public event feeds | Entire parsed provider record plus normalized geometry and times | Provider record ID, source URL, retrieval time, source-time fields, SHA-256 and source-specific limitations; prior changed versions remain available in storage |

Hashes identify stored **parsed JSON snapshots**, not original HTTP response bytes. They support deduplication and comparison within this system; they are not a forensic capture, a digital signature from the source, or proof that the source's factual claims are correct. Source timestamps are kept distinct from the time Spectra downloaded the record. Missing source timestamps remain missing.

General acquisition snapshots are bounded to **256 KiB per record, 2 MiB per batch and 500 records per batch**. An oversized record is omitted whole rather than silently cut and represented as complete. Results report stored/inserted/omitted counts and omission reasons. Repeated unchanged content updates receipt bounds; changed content creates another version. Records and investigation state are written in the same transaction.

Migration `069_spectra_public_evidence_records.sql` creates `spectra_public_feed_state`, `spectra_public_evidence_records` and `spectra_acquisition_evidence_records`. The acquisition archive belongs to its investigation/user/session. Reads join back to the investigation owner instead of trusting an evidence-row owner alone. The migration enables RLS, removes public/browser-role table access, and preserves access through the server role. Schema installation is an administrative step, not a request-time or poll-time side effect.

The Spectra **Collected records** control exposes saved JSON and provenance under **This investigation** and **Public geographic feeds**. It polls record/status APIs every 60 seconds while mounted; that display refresh is separate from backend collection. Unavailable persistence is shown as unavailable, not as a successful empty collection.

`SpectraPublicFeeds.ts` configures a five-minute USGS interval, a thirty-minute EONET interval and a five-minute NWS interval. Each provider collection is bounded to a twenty-second deadline, three pages, 1,500 records, 8 MiB per response, 16 MiB across the collection and 256 KiB per source record. A bound, unusable record or possible EONET source truncation produces an explicit `partial` result. Network/provider errors produce a failure status; they are not converted into invented records. Fixed official endpoints, redirect rejection and restricted NWS continuation URLs keep recursive pagination on the intended service. Successful single-page responses can reuse HTTP validators; partial or multi-page results do not retain a first-page validator as evidence of a complete snapshot.

`SpectraPublicFeedStore.ts` starts collection at application startup when a database is configured, then checks for due work thirty seconds after the previous cycle finishes. Each provider's next due time is durable. A 180-second database lease prevents replicas from collecting the same provider concurrently; HTTP retrieval holds no database transaction open. Successful records and state updates commit together. Partial results retain their usable records but do not advance the last fully successful collection time. Deterministic coverage limits retain the normal provider cadence; transient network/HTTP failures back off exponentially, up to six hours or the configured interval if longer. After twenty-four hours without a complete download, the next due request omits conditional validators so repeated `304` responses cannot let retained records expire without a fresh download attempt. Shutdown cancels active retrieval.

The global feeds are a rolling cache with version history: rows not seen for thirty days are pruned in batches of up to 1,000. Investigation acquisition snapshots live separately and are not deleted by this maintenance job. The public-record read API returns the latest retained version per provider/record ID; it is not an endpoint for exporting all historical versions. Its route defaults to 25 records and caps requests at 100; the underlying store has a separate hard ceiling of 500. The investigation archive route returns up to 100 saved records rather than an unbounded export.

| Optional server setting | Behavior |
| --- | --- |
| `SPECTRA_PUBLIC_FEEDS_ENABLED=false`, `0` or `off` | Disable background collection |
| `NO_INTERVALS=true`, `1` or `yes` | Disable background collection along with the application's existing interval suppression |
| `SPECTRA_PUBLIC_FEEDS_INTERVAL_MS` | Slow collection; cannot reduce a provider below its default interval, maximum twenty-four hours |
| `SPECTRA_PUBLIC_FEEDS_RETENTION_DAYS` | Global-cache retention, default 30 days, bounded to 7–365 days |

No new variable is required for the default collection schedule. `GET /api/spectra/public-records` exposes the global geographic feed records/status through the application, and `GET /api/spectra/sessions/:sessionId/records` exposes the requesting user's saved acquisition records. Both remain under Spectra authentication middleware, return private/no-store responses, and perform no external acquisition when read.

## Source contracts

### USGS earthquake records

- Endpoint: <https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson>.
- Feed format: <https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php>. USGS publishes hour/day/week/month windows and documents minute refreshes. The summary feed is a snapshot and has no page cursor.
- Each feature supplies its stable event `id`, `properties.time` and `properties.updated` in Unix milliseconds, a detail/source URL and Point coordinates `[longitude, latitude, depth_km]`. Depth is not surface elevation. Source records may be revised, including automatically located events.
- This collector's day window does not establish a complete historical catalog. For bounded historical work, the separate [catalog API](https://earthquake.usgs.gov/fdsnws/event/1/) documents time/geographic filters, a maximum of 20,000 results, and a 1-based `offset`. USGS explicitly recommends the real-time feeds for automated displays where possible.
- [USGS copyright guidance](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) places USGS-produced information in the U.S. public domain and asks users to credit USGS; separately copyrighted third-party material remains subject to its own terms.

### NASA EONET natural events

- Endpoint: <https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=100>.
- [Version 3 documentation](https://eonet.gsfc.nasa.gov/docs/v3) describes event IDs, categories, original source links and a `geometry` array. Each geometry has its own date and Point/Polygon coordinates; the array must not be mistaken for a single current position. Dates are frequently `00:00Z` when a more specific source time was unavailable.
- `status=open` and `days=30` deliberately limit coverage. The documented API has `limit` and date-window filters but no offset/page cursor. Reaching the configured limit is therefore a possible truncation, not proof of completeness. Its `bbox` order is west, north, east, south.
- NASA's [EONET disclaimer](https://eonet.gsfc.nasa.gov/what-is-eonet) says these spatial/temporal extents can be approximations and are for visualization/general information. Preserve EONET attribution and each record's source links. This integration retains metadata, not third-party articles or licensed imagery referenced by those links; linked content has its own terms.

### National Weather Service alerts

- Endpoint: <https://api.weather.gov/alerts/active> with an application-identifying `User-Agent` and `Accept: application/geo+json`.
- [NWS service documentation](https://www.weather.gov/documentation/services-web-api) describes currently keyless access, free open data, caching and rate limits whose numeric threshold is not public. Respect response cache/retry signals and avoid aggressive retries. The documentation mentions a possible future API-key requirement; the direct tests below required none.
- The [machine-readable specification](https://api.weather.gov/openapi.json) lists `limit`/`cursor` for `/alerts`, and pagination responses may contain `pagination.next`. It does not list those parameters for `/alerts/active`. Only follow a returned continuation that passes the feed's origin/path validation; do not invent offsets.
- Keep issuance (`sent`), effective/onset and expiry/end fields distinct. A warning's geometry is an affected region, not a measured person/device location.
- The [NWS geolocation guide](https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf) explains why many valid alerts have `geometry: null`, with UGC/SAME codes or zone links instead. Keep these records without inventing coordinates. Point/county queries cover both county and zone alerts; a zone-only query can miss county warnings. `/alerts` supplies only the recent seven-day history.
- [NWS reuse guidance](https://www.weather.gov/disclaimer) generally permits public-domain NWS content, requires accurate attribution and forbids presenting modified content as official government material. Third-party content can have separate restrictions.

## Existing providers and production configuration

The production variable-name inspection for Railway project `adaptable-youth`, service `bad-blue`, environment `production` found the following relevant existing names. No secret values are reproduced here, and the presence of a variable does not prove its account balance, permissions, validity or the success of a provider request.

| Purpose | Existing variable names |
| --- | --- |
| Search/discovery or retrieval | `FIRECRAWL_API_KEY`, `GOOGLE_SEARCH_API`, `SCRAPINGBEE_API_KEY`, `SEARXNG_URL`, `SERPAPI_KEY`, `TAVILY_API_KEY`, `OPENSERP_URL`, `DDGS_URL` |
| Place/geographic services | `CENSUS_API_KEY`, `GEONAMES_USERNAME` |
| Existing public-record services | `COURTLISTENER_API_TOKEN`, `FEC_API_KEY`, `GOVINFO_API_KEY` |

No `SPECTRA_*` variables were present in the inspected production variable names. No configured device-location feed was established by that inspection. The new global public feeds do not fill that gap and must not be described as device telemetry. Existing Census, GeoNames and CourtListener integrations are existing capabilities, not APIs newly connected by this work.

For public places, `SpectraPlaceContext.ts` already requests named OSM features from Overpass and nearby place records from GeoNames. The [Census geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) already provides a separate keyless U.S. address/geography fallback; its coordinates describe an address match, not a current observation. These paths should be retained and their returned records archived rather than adding duplicate discovery-only providers.

The public [Overpass service](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) is a shared resource with workload limits. Do not turn it into unrestricted bulk harvesting. The public [Nominatim service policy](https://operations.osmfoundation.org/policies/nominatim/) imposes an absolute one-request-per-second ceiling, identification/attribution/caching requirements and tighter limits on recurring bulk work. It is not used as a new background feed here.

## Verification evidence

Direct HTTPS requests used no Authorization header, cookies, signup or API keys. The application user-agent identified the test. Samples were temporary verification inputs outside the repository, not committed changing fixtures.

| Checked at (UTC) | Request | HTTP | Actual records | Response bytes |
| --- | --- | --- | ---: | ---: |
| 2026-10-11 00:11:06 | EONET open events, 30 days, limit 100 | 200 | 65 | 160,747 |
| 2026-10-11 00:11:08 | USGS all-day GeoJSON | 200 | 198 | 141,503 |
| 2026-10-11 00:11:10 | NWS active alerts | 200 | 550 | 2,576,019 |

The NWS sample included 511 records with null geometry, demonstrating why null geometry must not discard an otherwise valid alert. A separate Illinois-only request returned HTTP 200 and zero alerts, demonstrating that an empty valid response is different from a failed feed. The NWS OpenAPI document also returned HTTP 200 directly. Source availability and record counts are point-in-time observations, not an uptime guarantee.

All three saved response bodies were then passed through the implemented `collectSpectraPublicFeed` function using its injected fetch interface. It returned `ok` for each: **198/198 USGS, 65/65 EONET and 550/550 NWS records retained**. Assertions checked that the parsed source record remained unchanged, every normalized record retained the public-geographic-context classification, and all 511 null-geometry NWS records survived. NWS records kept `observedAt: null` and stored `sent` as the issuance/source-update time.

Local verification passed the existing Spectra suites, the new adapter and acquisition-archive checks, and all twelve offline public-feed store/lifecycle checks. The optional PGlite run passed a thirteenth check covering real PostgreSQL migration/query behavior, leases, deduplication/version history, retention and anonymous-access denial. After incorporating production commit `a98947f`, the complete `npm run verify:spectra` suite passed again. `npm --ignore-scripts run build` passed the build-script checks and produced the client, server and worker bundles. Repository-wide TypeScript checking still reports pre-existing errors; strict targeted checks for the new modules and UI passed. Local verification ran on Node 24.19.0; the project and production build specify Node 20.

The full `npm run build` lifecycle remains unverified locally: an existing unrelated prebuild step invokes the `tsx` CLI, whose Unix IPC socket is denied in this workspace (`listen EPERM`), including with a writable temporary directory. A minimal CLI probe reproduces the same restriction. The prebuild gate was not changed. The successful build-script run skips that lifecycle step and must not be described as a full lifecycle pass.

These results do not establish production deployment or live persistence. Production schema installation, rollout and persisted feed-record verification must be recorded separately when completed. No new API key is required; the existing production migration command installs the added tables before application startup.
