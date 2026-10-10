# Live verification and follow-up repairs

Public-place deployment `a74f2463-6321-43f3-9588-60d2a8474309`, commit
`a86e5ac07a8c5dff8a7c393c0a48ceafbeb1f2fe`, reached SUCCESS on October 10.

## Observed live

- Synthetic JPEG upload returned HTTP 200 in 182 ms. The existing fallback
  extracted coordinates and the January 1, 2020 capture timestamp.
- Acquisition request `9dfef25d-f886-40d2-888d-0c62afb9086e` recorded one
  supplied, normalized, accepted and solved observation; coordinate fusion
  executed and returned one candidate. The browser mapped the historical
  scene. This is a synthetic test, not real-world location accuracy evidence.
- Automatic public-venue search selected eight pages, retrieved four, and
  accepted no address. A follow-up supplying the Smithsonian visitor-page URL
  retrieved three of eight pages and still accepted no address. No map result
  was fabricated. Exact retrieval failure reasons were not exposed in that
  release, so the official page's failure cause is not yet established.
- Search smoke checks returned usable results for several providers, but
  OpenSERP returned 502 and SearXNG returned partial results. Endpoint health
  does not establish complete search reliability.

## Follow-up code

- Fix default-import compatibility for the installed EXIF reader in both
  extraction services. Accept its numeric GPS descriptions and validate
  coordinate ranges while retaining hemisphere signs.
- Exercise the actual decoder with a labeled synthetic JPEG, not mocked tags.
- Remove capture timestamps before phone-clue recognition in server and UI.
- Expose failed public-page selections alongside successful source assessments
  with bounded reason codes. Keep public-URL restrictions intact; do not expose
  raw errors or credential-bearing links.

The full Spectra verification suite and server compilation passed after these
changes. Frontend compilation passed for the timestamp change. These follow-up
changes require their own deployment and live verification. The broader goal
is not complete: automatic public-photo retrieval and account/device feeds
remain unconnected, and public-venue automatic mapping did not pass the live
test. No private-person search was run during this verification.
