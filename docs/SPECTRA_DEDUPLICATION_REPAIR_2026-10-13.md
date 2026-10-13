# SPECTRA back-end evidence integration: non-duplication and repair review

Date: 2026-10-13
Target: `Rjdclink/Bad-Blue`; comparison baseline: merged `develop` at `5dc9ee22e24cdb4a4c30ba70aa30889faea54510`.
Review branch: `codex/spectra-deduplicated-evidence-20261013`.

## Objective and map invariant

The existing map/client presentation is unchanged. New public media evidence collection, source validation, and generic non-identifying scene comparison operate in SPECTRA's back end. Geographic scene metadata and public context must never silently become authenticated subject-location measurements. This work does not identify faces, follow people on camera, or claim current personal whereabouts.

## Duplication assessment against merged work

- **PR #1333** already fixed production ESM EXIF imports, added a real synthetic EXIF fixture, performed byte-hash image comparison in the evidence ledger, improved recursive discovery deduplication, and reduced idle feed work. These are **not** reimplemented. The only additional EXIF repair here rejects missing, unrecognized or axis-inconsistent *raw* cardinal tags instead of silently treating them as north/east.
- **PR #1336** already introduced request lifetime cancellation, provider transport guards, private error logging, and corrected image EXIF references. Its implementation is retained. The new X post fetch and optional image model participate in those existing request-lifetime signals.
- **PR #1340** merged Firecrawl Keyless, Jina Reader, Crawl4AI, Tavily credit admission, text/CSV/Markdown retrieval, provider accounting, and improved cancellation. No duplicate crawler, provider orchestrator, or secondary evidence archive is created.
- The existing `SpectraEvidenceAssessment` groups downloaded images by SHA-256. This remains the **only canonical identical-byte deduplication ledger**. The new generic scene overlap summary does not recalculate/persist separate image-duplicate counts.
- The existing Element 84 STAC/Sentinel/Landsat catalog and Copernicus route remain authoritative. The proposed additional `sentinel-2-l2a` collection was **not** copied into this branch because it overlaps the existing satellite lanes and may not be supported by the configured Earth Search endpoint.
- The existing public Facebook/Instagram/X HTML image extractor remains the primary collection path. A round-robin budget prevents one platform's early results from exhausting the shared download cap; no duplicate collector is added. The new X API adapter is an *optional authorized per-post image expansion* for already retrieved public posts, not a new general-purpose crawler.

## Concrete back-end flow

1. Existing source discovery (including keyless providers) retrieves actual publicly accessible source documents and post HTML; searches, URLs, and mentions alone are **not** acquired image evidence.
2. An optional X v2 bearer token permits up to four direct lookups of successfully retrieved public post IDs; attached photo URLs are placed ahead of page thumbnails. Calls have bounded concurrency, fixed credential host, source-ID validation, request cancellation and truthful partial outcomes. The token is never sent to image CDNs.
3. The existing image collector downloads, validates, hashes and extracts EXIF from up to six cross-platform Facebook/Instagram/X leads (fairly rotated). Bluesky and Mastodon continue using their existing bounded media adapters.
4. A deployment-opt-in Claude scene analysis can inspect at most one already downloaded image in each collection with a bounded six-second wait. It yields **allowlisted non-person** object, vehicle and scene categories only. Late/failed/invalid model responses are excluded, and the original image evidence remains intact.
5. `mergePublicRetrievedMetadata` passes the validated image `structuredRecord` through `buildSpectraAcquisitionRecords` to tenant-scoped persistence. Existing byte-hash evidence dedup retains the authoritative source grouping.
6. `summarizeSpectraSceneOverlap` compares only distinct classified image hashes and stores aggregate, uncertainty-labeled generic-tag overlap in the investigation's **private persisted state**. It supplies no extra map payload, coordinate, facial match, person identity or verified location.
7. Configured camera directory queries reject invalid coordinates/radius and unsafe asset links. This only validates source metadata; it does not fetch or analyze live camera frames.

## Verification and remaining release gates

New and strengthened tests are registered in the existing manually executable `npm run verify:spectra` and `npm run verify:spectra:records` scripts:

- Official X post retrieval: fixed token destination, guarded IDs, deduplication, photo-only media keys, partial outcomes and late cancellation.
- Real image records: balanced Facebook/Instagram/X scheduling, MIME signatures, fixed download budgets, redirects, validated EXIF cardinal tags.
- Visual scene analysis: allowlist-only labels, no identity/position admission, comparison across distinct hashes, cancellation of a noncooperating model.
- Camera URL and geospatial input validation.
- Existing context-pipeline structural checks now verify that downloaded image bytes still reach the original archive, that newly added modules transpile, and that the existing map response shape remains unchanged.

The available isolated JavaScript/module tests are **not** a full dependency-complete Node 20 repository test or authenticated production acceptance test. Full `npm run verify:spectra`, `npm run check` (existing whole-repo errors may remain), and production build/release checks must complete before merging.

No GitHub Actions workflow has been used for verification. No code, provider setting, branch source, or deployment was changed in Railway. As last verified, production `adaptable-youth / production / Bad-Blue` tracks `fix/spectra-reliability-review-20261013`, not `develop`; merge-to-production is **not** automatically configured. The new X token and scene enable flag are not configured in the observed production variable-name inventory. Do not claim those optional providers run in production without explicit configuration and a successful real test.

## Premerge rule

The release must come from an explicitly selected reviewed commit, contain no frontend/map file changes, pass the production build and all current Spectra regressions **without bypassing failing checks**, and then be deployed **only** to `adaptable-youth / production / Bad-Blue` after approval. If those gates cannot be demonstrated, leave the PR unmerged and production untouched.
