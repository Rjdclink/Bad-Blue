# SPECTRA evidence and performance audit — 2026-10-12

This review is based on the `develop` tree of `Rjdclink/Bad-Blue`, the SPECTRA implementation files, existing verification scripts and open related PRs. It is **a repository review and a narrowly scoped code change**, not a production test or a claim that a source is configured.

## What is implemented

| Evidence family | Concrete code | What it actually establishes |
| --- | --- | --- |
| Acquired public source records | `SpectraPublicRetrieval.ts`, `SpectraAcquisitionRecords.ts`, `SpectraAcquisitionPersistence.ts`, migration `069_spectra_public_evidence_records.sql` | Successfully retrieved source snapshots are archived separately from search leads; discovery snippets and failed fetches do not become retrieved facts. |
| User-supplied original media | `server/routes/gps.routes.ts`, `SpectraMediaEvidence.ts` | Available EXIF capture GPS and capture time can describe a **historical media scene**. The source file does not prove an investigated person's present position. |
| Public social image snapshots | `SpectraPublicImageRecords.ts`, `SpectraPublicMediaPriority.ts` | Bounded, accessible public image downloads can produce SHA-256 and whitelisted EXIF metadata. Bytes are not archived. The priority list sorts capture **scenes**, not identified people. |
| Facebook, Instagram and X | `SpectraPublicRetrieval.ts`, `SpectraPublicImageRecords.ts` | Public post HTML may expose allowable CDN image links. This is **not** complete account, feed or private-post retrieval, and a discovered link alone is not an image fetch. |
| Public camera directory context | `SpectraCameraDirectoryAdapters.ts` | Configured JSON sources can report cameras and image/video URLs near a known area. A directory URL is not an acquired or analyzed camera frame and does not identify a person. |
| Satellite catalogs | `SpectraPublicSatelliteRecords.ts` | One bounded Earth Search STAC query can return scene metadata from Sentinel-2 and Landsat collections with distinct acquisition times. This is not live tracking or multi-provider image fusion. |
| Keyless geographic event feeds | `SpectraPublicFeeds.ts`, `SpectraPublicFeedStore.ts` | USGS earthquakes, NASA EONET events and NWS alerts provide source-dated **public geographic context**, not a target person's coordinates. |
| User-controlled location exports | `SpectraTelemetryImport.ts`, `server/routes/geoconsole.routes.ts` | Date-bearing coordinates can be imported from supported file types. An imported observation still requires explicit provenance, subject/device authorization and location-quality checks. |
| Identity and regional assessment | `SpectraPublicProfileIdentity.ts`, `SpectraRegionalInference.ts`, `SpectraLiveConfidence.ts` | Name/contact matches and regional records can be described with uncertainty. Profile-name matching is not biometric identification or account-ownership proof. |

## Evidence separation remains essential

A source record is not a location measurement merely because it contains a coordinate. A camera's location identifies the camera. A satellite scene's footprint identifies an area and acquisition time. Photo EXIF identifies a capture scene if authentic and sufficiently dated. A public profile or article may mention a city without establishing a person's presence. Source-event timestamps, publication timestamps and retrieval timestamps must not be conflated. Duplicated publishers and reposts must not be counted as independent corroboration.

The existing types and checks in `SpectraPublicEvidenceProvenance.ts`, `SpectraMediaEvidence.ts`, `SpectraPublicMediaPriority.ts` and `SpectraLiveConfidence.ts` separate scene/context from verified subject telemetry. Do not bypass those constraints by feeding every archived object into person-coordinate fusion.

## Material capabilities **not completed** in this review

- Biometric face identification or cross-account identification by face is not an implemented, verified capability in the reviewed SPECTRA source files.
- Complete Facebook, Instagram or X retrieval is not available from these adapters. Restricted content depends on authorization and provider access; no free universal endpoint was identified.
- Camera-frame fetching, computer vision on camera images, and person matching through public cameras are not implemented by the reviewed camera-directory adapter.
- Multiple independently operated satellite image providers, cross-date pixel registration and object change detection are not implemented by the single existing STAC scene metadata adapter.
- A current physical position cannot be established merely by increasing OSINT request volume. Any real-time claim needs current, authorized subject/device measurements and source-specific validation.
- The reviewed source paths do not establish an end-to-end production deployment, connected provider credentials, or real-world accuracy for location inference.

## Safe integration direction

Retain all successfully acquired records in the auditable source archive with publisher, source record ID, content hash, acquisition time, source event/capture time, access basis, and explicit limitations. Build a separate, non-person scene/context timeline for accessible satellite imagery, public environmental events, and voluntarily supplied media. Only opt-in, authenticated first-party device telemetry should enter an individual's live-position fusion. A search-result title, face resemblance, image scene, camera location or repost should not silently become a location measurement.

## Repairs in this branch

`SpectraPublicFeedStore.ts` previously executed the feed-source upsert and retention prune on every 30-second collection tick, even when provider `next_due_at` excluded any HTTP collection. This branch registers source metadata once per collector lifecycle (retrying after registration errors), updates provider configuration rows only when fields change, and runs the bounded retention prune at most hourly per process (retrying failed attempts). Provider due-date checks, leases, bounded upserts, backoff, cancellation and feed provenance remain unchanged. The offline fixture adds consecutive idle-cycle assertions.

## EXIF decoding repairs and regression

A known failure was reproduced in earlier PR #1289 (still open and not merged into `develop`): the installed ExifReader module's namespace import cannot reliably call `load` in the production ESM runtime, and the reader can emit numeric GPS tag descriptions that the upload parser rejects. This branch ports the minimal default-import and decimal/DMS handling into `server/services/gpsIntelligence.ts` and `MediaMetadataExtractor.ts`, with coordinate bounds and hemisphere validation. It additionally fixes the same import in `SpectraPublicImageRecords.ts`, which PR #1289 did not touch.

A labeled **synthetic**, not person-derived JPEG fixture now exercises both uploaded-media and public-image EXIF extraction using the installed decoder, checks capture time and west-longitude signs, and verifies that geotags remain **scene evidence**, never an identified person's current coordinate. The new regression runs via `npm run verify:spectra`.

**Verification status:** The code and regression fixtures have been committed to this review branch, but neither the new offline fixture nor the full `verify:spectra` command has been executed in this environment. Production deployment and behavior remain unverified; no claim of end-to-end location inference completion is made. The changes overlap PR #1289 and should be coordinated rather than merged twice.
