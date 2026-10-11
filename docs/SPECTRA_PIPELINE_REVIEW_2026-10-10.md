# Spectra evidence-pipeline review — October 10, 2026

## Production evidence

The authorized self-test used only the user's previously supplied identifiers;
the expected location was withheld. No third-party-person test was run. On
deployed commit `f1ef610`, request `fcf1c701-080d-4125-b9e6-ce94a12d6c03`
completed at approximately 20:19:45 UTC with 32 source groups referenced and no
mappable location estimate.

Provider-attempt accounting: 133 result-bearing, 97 empty, 24 failed, 22 timed
out, 593 skipped, 0 pending; 276 dispatched and 4 partial responses. These are
attempt counts, not independent sources or accepted location evidence. The
earlier release had 8 result-bearing attempts; the tests differ and are not a
controlled performance benchmark.

The production variable-name inventory contains none of the Spectra managed
device URL/token pairs, `SPECTRA_ACTIVE_PROVIDER_ADAPTERS`,
`SPECTRA_GENERIC_JSON_ADAPTERS`, or `SPECTRA_TELEMETRY_HMAC_SECRET`. There is no
configured automatic telemetry pull collector or signed telemetry receiver.
The reviewed Spectra modules contain normalization/ingestion support, not
connected browser-history, email-activity, or social-account-login importers.
Parser availability must not be represented as actual upstream collection.
No secret values were read or changed.

## Confirmed defects and changes

- Discovery and source-page retrieval shared one 15-second abort signal. Once
  discovery exhausted it, reading the selected pages began already cancelled.
  Reserve 10 seconds for discovery and a separate bounded retrieval stage
  (abort at 4.5 seconds; stop waiting at 5 seconds). Preserve collected search
  leads when page retrieval fails. The same source-selection limits and
  evidence-admission rules remain in place.
- Stop cancelled public retrieval before DNS work and before a later HTTP
  request after DNS resolution. No retries or access-control workarounds added.
- Telemetry normalization rejections were discarded from the visible outcome.
  Report their count separately from collection failures and zero observations.
- Add bounded, non-personal pipeline counts to the acquisition response, saved
  state and request-correlated logs: selected/retrieved pages, input observations,
  quality rejections, solved observations and whether coordinate fusion ran.
  Do not log targets, URLs, records, coordinates, keys or exception messages.
- Add an expandable evidence-status explanation to Spectra. Report partial
  provider responses accurately rather than describing all incomplete coverage
  as skipped or pending checks.

This batch changes Spectra route timing, cancellation and diagnostics. It does
not change Lexara's shared provider mesh, conversation, voice or background.
It does not add collectors, alter identity matching, lower evidence thresholds,
or equate a media capture scene with a person's current position.

## Validation

- Seven offline pipeline regression checks, including the expired-discovery
  reproduction, an indefinitely stalled retrieval, normalization failure,
  quality rejection, regional-vs-coordinate-fusion distinction and partial
  result messages. All fixtures are non-personal and make no network requests.
- Nine feed-diagnostic checks, eight configuration checks, client-control
  checks, 134 structural checks and 35 production invariants pass.
- Five changed TypeScript/TSX files transpile with esbuild. This is not a full
  application type check or live validation of the new release.

## Remaining limits

The self-test has not produced a location estimate. Keyless DDGS and OpenSERP
returned upstream errors under the real workload. Short provider deadlines and
queue admission limits still caused incomplete coverage. The patch reserves
page-retrieval time; it does not claim to solve every upstream/provider issue.
The new pipeline counters are intended to identify the actual evidence-loss
stage on the next run.

No internet scan can supply private account logs or device measurements simply
because an ingestion adapter exists. Actual supported feeds and their account
authorization are required. Public search results may lack dates, relevant
coordinates or sufficient independent evidence; processing must preserve that
uncertainty.

Primary references checked for source-access feasibility:

- https://developers.google.com/photos/support/updates — Library API access to
  app-created content; access to other existing library items uses supported
  selection flows. Do not promise unrestricted background access to old photos.
- https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0 —
  tenant sign-in records are permission-controlled, not public web activity.

No GitHub Actions or Railway AI agent is used. Deployment and live verification
of this batch are recorded in PR #1286 after approval/application.
