# Spectra public-evidence location blueprint — 2026-10-11

## Intended behavior

Spectra opens the map immediately, presents the best available **location hypothesis** and a broad uncertainty area when a geographic clue exists, and keeps collecting public records. Each new record can strengthen, weaken, replace, or split the hypothesis. A low confidence score is not a veto on showing a labeled best guess. A guess can happen to be right; accuracy is measured later against known outcomes, while confidence describes the evidence currently available. If there is no geographic clue at all, show the map and the search in progress without inventing a point.

Inputs such as a name, phone number, email address, or Facebook profile URL are identity and discovery clues. They do not themselves establish a place. The intended output is an **estimate with basis and uncertainty**, not a claim of live GPS or a guaranteed current address.

## What the five reference products contribute

| Reference | Transferable method | Access reality / what it does not provide |
| --- | --- | --- |
| [ShadowDragon SocialNet](https://shadowdragon.io/products/socialnet/) | Public aliases, posts, social relationships and available geographic indicators can suggest identity and places. | [SocialNet API](https://shadowdragon.io/products/socialnet/) is a contact/vendor integration, not a keyless general-purpose record feed. |
| [GeoSpy](https://dev.geospy.ai/docs/routes) | An image can generate candidate capture locations, subject to uncertainty and capture-date checks. | Its hosted API requires a subscribed plan and key; an inferred photo scene does not establish the subject's presence now. |
| [LexisNexis Accurint](https://risk.lexisnexis.com/products/accurint-for-government) | Reconcile identity and historical records; verify records independently because source errors occur. | Licensed, use-case-controlled access; nonpublic and law-enforcement-only data cannot be replaced by a free API key. |
| [Maltego](https://www.maltego.com/professional-vs-professional-standard-plan/) | Link entities and source-specific facts, preserve conflicting associations and provenance. | Data Pass requires a plan/credits; external connectors often require the customer's provider keys. It is not itself a universal free feed. |
| [Hunchly](https://support.hunch.ly/article/67-2-hunchly-data-forwarding) | Preserve captured pages and metadata and forward structured JSON snapshots to an evidence store. | Capture/forwarding cannot manufacture a source record or grant access to a restricted one. |

## Newly verified, direct public record routes

These are **source records**, not search-result titles. They can be collected only when the relevant public content exists and is accessible. No universal person coverage is implied.

| Route | Record obtainable without a new key | Fit and limit |
| --- | --- | --- |
| [Bluesky / AT Protocol](https://atproto.com/guides/reading-data) | Public account profile and post records; handles can resolve to stable DIDs. | Verify the account belongs to the subject; a post is dated online activity, not a present location. |
| [Mastodon public API](https://docs.joinmastodon.org/methods/accounts/) | Public status JSON by a known instance account ID, on instances permitting anonymous reads. | The documented account lookup endpoint requires a user token. The production user token now enables lookup on the configured instance; a supplied profile URL still does not establish ownership or current location. |
| [Wikimedia imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo) | Public file revisions, upload times, uploader, and EXIF metadata where present. | An upload date is not a capture date; a location on an image is the scene/capture location and needs independent subject association. |
| [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | News article records with publication and source links. | A mention of a person or place is only a lead until the article itself is retrieved and checked; news can be historical or about another person. |

The existing production variable-name inventory includes search/retrieval keys and `COURTLISTENER_API_TOKEN`, `FEC_API_KEY`, `GOVINFO_API_KEY`, `CENSUS_API_KEY`, and `GEONAMES_USERNAME`. Production now also lists `SPECTRA_MASTODON_ACCESS_TOKEN` and `SPECTRA_MASTODON_INSTANCE_URL`; their values were redacted and runtime validity remains unverified. Presence of key names does not verify validity or access rights, and those services do not turn an identifier into a current physical location.

## Open-source implementation references

| Reference | Reusable pattern | Constraint |
| --- | --- | --- |
| [SpiderFoot](https://github.com/smicallef/spiderfoot) | Modular source discovery and typed correlation, with many keyless modules. | Modules are not a shared pool of person-location data; check each source independently. |
| [Splink](https://github.com/moj-analytical-services/splink) | Probabilistic record linkage across names and independent fields. | Needs several informative fields; a common name alone is weak. |
| [Nomenklatura](https://github.com/opensanctions/nomenklatura) and [FollowTheMoney](https://github.com/alephdata/followthemoney) | Keep source statements, candidate entity links, merge decisions and contradictions distinct. | Importing a model does not resolve mistaken identities automatically. |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | Optional full page WARC/WACZ capture alongside normalized facts. | Follow publisher access and crawler limits; heavier than the existing extracted-document snapshot. |
| [GeoCLIP](https://github.com/VicenteVivan/geo-clip) | Local, keyless image scene estimates when a relevant original image exists. | Requires model/runtime resources and independent checks of scene, person, and date; no person-location feed. |

## Actual repository map and missing work

| Step | Present in repository | Gap to close |
| --- | --- | --- |
| Input and map | `client/src/pages/spectra.tsx` opens the map; `server/routes/spectra.routes.ts` parses target and details. | Show a clearly labeled provisional hypothesis/uncertainty area as soon as one geographic clue exists, then revise it without restarting the investigation. |
| Discovery | `SpectraSourceRegistry.ts` creates adaptive queries, capped at 8 passes / 48 queries / 160 candidates; `SpectraPublicRetrieval.ts` fetches a bounded subset of actual pages/JSON. | Add direct, bounded public-record adapters rather than relying on search indexing; report inaccessible/empty/partial separately. |
| Evidence store | `SpectraAcquisitionRecords.ts`, `SpectraAcquisitionPersistence.ts`, and the `069` migration retain retrieved records; archive rows expose source IDs where supplied and older versions through tenant-scoped pagination. | Attach source event times and explicit identity assertions to each location claim used by the hypothesis, and distinguish derivative stories from independent publishers. |
| Identity | `SpectraIdentityBinding.ts` handles certain provider telemetry bindings; public city policy rejects many weak matches. | Explicitly link each public account/article/file to the right subject using independent clues and retain competing matches. A phone/email/name match must not silently attach an unrelated post. |
| Location claim | `SpectraRegionalInference.ts`, `SpectraCityDiscoveryPolicy.ts`, quality gates, solver and `SpectraLiveConfidence.ts` distinguish some regional hints from coordinate observations. | Model residence, workplace, attended event, pictured scene, mentioned place and measured position as different relations; use the source event time and geographic resolution. Never turn a venue's coordinates into a person's measured point. |
| Progressive update | `/api/spectra/acquire` collects a bounded batch and may stop when city readiness or diminishing returns is met; the record UI polls for saved records. | Persist a resumable investigation queue; publish candidate revisions as records arrive; continue independent source families within rate/retention budgets until no new evidence or a user stops the search. Confidence/sufficiency should tune priority, not hide the current best guess. |
| Explanation | Current diagnostics distinguish attempted providers, retrieval, rejected observations and regional candidates. Provisional cities now expose the actual supporting sentence, publisher URL and its unverified name match. | Expose contradictory record IDs, source dependence, alternative city, uncertainty radius and update history. Search attempts are not independent corroboration. |
| Evaluation | Existing tests cover synthetic false-city matches and evidence quality. The offline benchmark runner now aggregates top-1/top-3, coverage, abstention and false positives by case category without printing case identities. | Obtain a withheld-answer set of consenting known-location cases across common names, sparse records, stale addresses, conflicting cities and duplicate syndication, then run it. Only call it “decently accurate” after measured real-world results. |

Implementation pass in this branch: an explicitly supplied Bluesky or Mastodon profile yields bounded public profile and post/status JSON, retaining the profile even when the feed is unavailable; a supplied Wikimedia Commons file yields imageinfo JSON without treating image metadata as a person's position; a GDELT exact-name lead can trigger retrieval of up to three actual publisher articles. These feed Spectra's existing acquisition archive and report separate outcomes; investigation records now expose older versions through tenant-scoped pages. Mastodon account lookup uses the production `SPECTRA_MASTODON_ACCESS_TOKEN` only on the configured instance; its public statuses use no token. The production discovery path already reads configured Tavily, SerpAPI, ScrapingBee, search endpoint and GeoNames variables where applicable. A single fetched, dated residence statement can produce a broad, labeled provisional city with source links; unverified profile records are excluded from person-city inference. The open Spectra page refreshes acquisition every five minutes while visible. This is a bounded session loop, not a durable job. Search and background URLs alone still do not create an admissible subject/place/time claim.

The next local pass adds bounded first/last-name profile discovery on Bluesky's public API and the configured Mastodon instance. Search results containing canonical public profile links can also trigger source-JSON reads, even when those links were not explicitly supplied. The connector fetches at most four candidates per platform and retains only fetched profiles whose own display names match the first and last names. An exact email or phone number printed in public profile text moves a candidate ahead in the fetch order. Candidate profiles and posts are archived with an unverified subject association and cannot become location observations. A bio that also states a city and prints the exact supplied contact may support a broad **profile-city hypothesis**, explicitly labeled as undated and ownership-unverified. The Mastodon search uses the existing production token with `read:accounts`; it has not been checked against the live instance. Bluesky post snapshots retain public image URLs and alt text from the feed view, without claiming image bytes were downloaded. The direct-record regression is now included in `verify:spectra:records`. Competing fetched residence-city claims remain visible on the map, with broad uncertainty, even if one city has stronger independent corroboration.

## Record and hypothesis contract

1. Store source bytes or an explicit extracted snapshot, canonical URL, provider, publisher, stable record ID, content hash, HTTP result, retrieval time and source publication/capture time separately. A failed fetch stays a lead, not evidence.
2. Extract claims as `{subjectCandidate, relation, place, eventTime, publicationTime, sourceRecordId, extractionMethod, limitations}`. Preserve the exact sentence/field supporting the claim and the original record. Missing times and place precision stay missing.
3. Link records to candidate identities, with positive and contradictory attributes and an explicit `unknown` state. Multiple pages repeating the same upstream story form one source family.
4. Rank geographic hypotheses by subject fit, directness of place relation, source independence, freshness, contradictions and spatial granularity. A residence record supports a broad historical residence hypothesis; a dated event may support a past event location. Display the best current hypothesis with its basis even when confidence is low, except when no geographic evidence exists.
5. Recompute after every accepted batch; retain prior hypotheses and explain why the leading place changed. A confidence percentage is descriptive and calibrated on the held-out set, never a substitute for source-backed reasoning or a gate that prevents a provisional map estimate.

## Acceptance checks before calling the goal met

- For a consenting test with name, phone, email and an optional profile URL, Spectra retrieves and saves actual public records, binds only verified account/source associations, and emits the first justified regional hypothesis while background collection continues.
- A later independent record updates the map and explanation; conflicting evidence can move or split the hypothesis. Repeating the same article on several websites does not inflate support.
- An old address, a profile-city field, an image scene, or a geocoded venue never becomes a claimed current person coordinate by itself.
- The benchmark reports achieved accuracy and coverage at each geographic scale. If no meaningful public geographic evidence is found, the result remains unknown rather than showing a fabricated precise point.
- All changes remain inside Spectra's acquisition, evidence, map and evaluation paths; Lexara voice, communication and its separate background search behavior are unaffected.

**Dependency that code cannot supply:** public source records actually tying the particular person to a place and time. The sources above improve coverage when such records exist; no free key or GitHub package makes every name/phone/email/profile combination sufficient for a consistently accurate current location.

## Offline accuracy check

Run `node --import tsx scripts/run-spectra-regional-benchmark.ts <cases.json>` against privately held, independently verified examples. The file must contain `{ "asOf": "2026-10-11T12:00:00Z", "cases": [...] }`; each case has a unique `id`, `subject`, actual retrieved `sources` (including `metadata.fetchedExcerpt`, `metadata.sourceUrl`, `metadata.retrievedAt` and any source `publishedAt`), an `expected` `{ "city", "state" }` or `null` for a negative control, and a `category` from `common_name`, `sparse`, `stale`, `conflicting`, `duplicate`, `other`. The runner prints only aggregate counts and rates. Its included verification uses synthetic examples and **does not measure real-world accuracy**.
