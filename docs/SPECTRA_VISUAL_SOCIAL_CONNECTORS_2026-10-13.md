# SPECTRA visual evidence and public-source connector review — 2026-10-13

**Review base:** `Rjdclink/Bad-Blue` `develop` at `42a5255e3ba48b6f82d185e594b7188dbdbc6a84`.
**Change branch:** `codex/spectra-visual-evidence-connectors-20261013`.
**Release status:** proposed, unmerged, **not production-verified**. Verification scripts are committed but have not been executed in this environment because a local repository clone/dependency installation was not available.

## Scope, blueprint and boundaries

SPECTRA is an evidence-acquisition and uncertain geographic-context system, not a source of universal real-time person coordinates. An image location, camera coordinate, satellite scene footprint, public mention, and verified device measurement have different meanings. They must not be collapsed into a person's present location. New model-generated categories remain *unverified scene descriptions*, never identity evidence.

Checked the current SPECTRA architecture against the October 10–12 repository audits and these external implementation contracts:

- [X Post lookup integration guide](https://docs.x.com/x-api/posts/lookup/integrate): fixed provider-origin bearer requests, post-specific `attachments.media_keys` expansion and `media.fields=url,type`. Credentials are not sent to photo CDNs.
- [Official Instagram API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api): Instagram Graph API is for appropriately authorized professional accounts; it does not provide unrestricted consumer-account or private-photo retrieval.
- [Meta Page Photos reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/): managed Page permissions and/or approved public Page access are required; a Facebook profile URL is not permission to read private photos.
- [Element 84 Earth Search](https://github.com/Element84/earth-search) and [STAC Item Specification](https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md): catalog entries distinguish acquisition date, footprint, collection and assets. An asset URL is not an inspected image or a live stream.
- [Scrapy duplicate filtering](https://github.com/scrapy/scrapy/blob/master/scrapy/dupefilters.py) and [FollowTheMoney](https://github.com/alephdata/followthemoney): bounded duplicate-resistant discovery with original source statements retained. Existing SPECTRA request-local dedup and evidence assessment follow these patterns; this patch does not replace them.

Source connectors are bounded by provider authorization, request ceilings, deadlines and source provenance. “Search all of the internet” is not a technically possible, permission-free or testable completion criterion.

## Integrated changes and evidence meanings

| Area | Implemented | Boundaries |
| --- | --- | --- |
| X public post images | `SpectraXPostMedia.ts` looks up **up to four successfully retrieved public post URLs** on the fixed official X API host if `SPECTRA_X_BEARER_TOKEN` is set. It requests attached image media fields; returned HTTPS photo leads run through the existing bounded image-byte inspector in `spectra.routes.ts`. API failures and configuration state have separate acquisition counters. | No private/protected posts, account crawling, historical timeline scan, or invented photos. A source post belongs to an unverified identity until independently associated. |
| Facebook / Instagram / X public image inspection | Six total image downloads are now scheduled round-robin across those three platforms, up to four per platform, instead of letting the first platform consume the global budget. Metadata images require already retrieved public post HTML, or the approved X API expansion; each image uses SSRF checks, signature and size validation, EXIF/byte hash and an evidence archive entry. | Meta Graph API account/photo access has **not** been implemented; FB/IG coverage remains accessible post HTML/metadata and CDN bytes. Site login barriers cannot be bypassed. |
| EXIF geotags | Validate cardinal direction tags using raw ExifReader N/S/E/W values, not human descriptions, to avoid wrong-sign longitude/latitude. | Coordinates describe a photo's capture scene if authentic and sufficiently dated, **not** subject presence. The overlapping unmerged PRs must be reconciled. |
| Objects, vehicles, scene | `SpectraVisualSceneAnalysis.ts` supplies fixed enumerated categories, bounds, a 6-second model deadline, hash provenance and a fail-closed parser. `SpectraPublicImageRecords.ts` invokes it only when `SPECTRA_SCENE_ANALYSIS_ENABLED=true` and the existing Claude key is configured. At most one already downloaded image per collection is sent to Claude; model failure leaves byte/EXIF evidence intact. | Labels are model interpretations, not verified sightings; no face ID, face embeddings, license plate extraction, OCR of personal markers, precise geolocation, or person-position telemetry. Enabling requires operator authority to send image bytes to a provider. |
| Photo comparison | Compare exact SHA-256 values, plus Jaccard overlap of explicitly tagged generic scene categories. Returns `facialIdentityCompared=false`, `sharedPersonIdentified=false`, `locationMatchVerified=false`. | Scene overlap is not an identity, same-object-instance or location match. Cryptographic hash equality is only for identical bytes; no perceptual-near-duplicate model is claimed. |
| Satellite metadata | Query both Sentinel-2 collection names and Landsat in the existing keyless Element 84 STAC query. Accept HTTPS catalog thumbnail links as `previewUrl`; enforce ordered latitude bounds. | No satellite frame has been fetched, rendered, registered or analyzed by these changes. Catalog date and footprint remain historical environmental context. |
| Public camera directories | Bound radius before interpolating into configured HTTPS directory query; reject nonfinite coordinates/radius; reject private IPv4-mapped IPv6 and insecure/local/nonstandard-port camera asset links. | Directory camera position is **not** the position of anything in its field of view. This change does not acquire a video frame or do face/vehicle tracking. |
| Reliability and verification | Added deterministic synthetic/offline X, visual-scene, camera URL and cross-platform allocation fixtures; included new tests in `verify:spectra:records`. No tokens/images/identities are stored in fixtures. | Tests still need execution in a dependency-complete environment. No live X/Meta/STAC/camera authorization or deployment has been verified. |

## Configuration

- Optional `SPECTRA_X_BEARER_TOKEN`: application bearer token for the official X API; applicable provider entitlements, usage quotas and access rights are external prerequisites.
- `SPECTRA_SCENE_ANALYSIS_ENABLED=false` by default; enabling sends at most one available media image per platform collection to the preexisting configured Claude media model. Inspect provenance, publication rights, data-processing permissions and retention first.
- Existing `SPECTRA_CAMERA_JSON_FEEDS` config accepts authorized HTTPS JSON camera directory sources. The adapter reports source URLs and timestamps, not fetched frames.

## How to verify before accepting or merging

In a complete Node/dependency checkout, run:

```bash
npm ci
npm run verify:spectra:records
npm run verify:spectra
npm run check
```

Check the exact `package.json` script names in the final checkout, because the repository has several overlapping Spectra verification PRs. Run a frontend/build check per project workflow; check private-provider runtime failures separately using explicitly approved tokens. Synthetic tests must not be represented as evidence of real-world location accuracy.

Acceptance criteria:

1. Offline X fixture exercises the fixed API host, post ID identity, de-duplication, media-key filtering, count reporting, failures and cancellation; no credential lands in archived records.
2. Facebook/Instagram/X allocation fixture returns two images from each when enough accessible source pages exist, not six from the first platform.
3. Visual-scene fixture drops model-proposed person/plate/address fields, keeps only allowed object/vehicle/scene categories and does not promote a model result into an observation.
4. Camera and satellite fixtures reject private asset URLs, invalid query coordinates, stale/out-of-scope catalog data and fabricated provider responses.
5. A controlled real provider smoke test checks configured credential permissions, platform access restrictions, date attribution, reasonable request volume and actual fetched bytes. This last condition is **not** satisfied here.

## Merge coordination and remaining work

Open and overlapping pull requests on October 13 include #1335 (retrieval, EXIF, diagnostics), #1336 (evidence, requests, camera URLs, EXIF, route and polling) and #1338 (diagnostics). Do not blindly merge this branch on top of those patches. Review each changed file, rebase against the desired baseline, resolve duplicate fixes, run all standard tests/type checks, then obtain review approval.

Incomplete requirements: biometric face comparison or identification, official Meta Graph photo access for authorized accounts, satellite pixel analysis, street-camera frame inspection, multi-camera tracking, general-purpose comprehensive internet crawling, and real-world calibrated person-location accuracy. They are **not** claimed completed here. Only separately authorized device telemetry may support a live subject location.
