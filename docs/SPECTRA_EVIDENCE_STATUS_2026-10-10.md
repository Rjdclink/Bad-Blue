# Spectra evidence status follow-up — October 10, 2026

## Changes

The server already returns provider-attempt counters and observation-quality
issues, but the console previously showed broad failure notices. This change
displays the existing counters and fixed reason labels on successful and failed
responses, including the separate public-venue response path.

- Search attempts are distinct from independent sources and accepted evidence.
  A dispatched wrapper does not prove that a provider was reached. Partial
  responses overlap other outcomes.
- HTTP failures, queue capacity, queue waiting, timeouts and unavailable
  providers are shown separately. The current unavailable category does not
  distinguish missing configuration, disabled sources or cooldowns; the UI
  explicitly leaves that cause unconfirmed.
- Configured collectors, fulfilled collection attempts and coordinate
  observations remain separate. Supplied and saved observations are identified
  without claiming that these input categories are disjoint.
- Quality warnings are not counted as rejected records. Duplicate exclusions
  and missing-accuracy warnings can coexist on the same input batch.
- Historical media and stale/conflicting location evidence receive explicit
  labels. The response no longer describes saved records as newly acquired
  observations for an identified person. Spatial corroboration does not certify
  subject identity.
- Display text uses fixed provider, error and quality labels. Unknown raw
  strings and exception messages are not copied into the new notices.

Acquisition, source access, authentication, inference and evidence thresholds
are unchanged. This patch supplies no new source of measurements.

## Older-component reachability

A static esbuild dependency traversal from `server/index.ts`, with the repository
TypeScript configuration and external packages, inspected 922 source inputs.
The random-signal sandbox in `geoconsole/signalFusionEngine.ts`, the
`iceEngine/demo.ts` module and the unfinished Pantheon `locationIntelligence.ts`
module were absent. The IceEngine index and media metadata extractor were
present. The IceEngine map function throws when no GPS is extracted; its demo
inputs were not pulled into this server graph.

This is a compile-time import finding, not proof about every runtime entrypoint,
worker, external package or future configuration. No unused module was deleted
or described as a working acquisition source.

## Verification

- Eleven offline checks cover diagnostic counters, known error labels, unknown
  text suppression, absent legacy fields, invalid counters, empty telemetry,
  overlapping inputs, quality warnings, historical evidence, conflicts, both
  response paths and failed application responses.
- Full `npm run verify:spectra` passed with the first ten new checks. The
  additional failed-response check passed after the final small UI edit.
- Strict TypeScript checking passed for `spectraFeedStatus.ts`.
- Vite production client build passed; existing large-chunk warnings remain.
- Static server bundling and `git diff --check` passed.
- Tests ran locally on Node 24; production declares Node 20. Full application
  build and authenticated application acceptance are separate checks.

The parent release `d9d4a86ba736dc57c0c22b87f46c6692bb0b44a7` reached Railway
SUCCESS as deployment `8168aa9a-8b77-4aae-b9c0-6e8671878579`, with a successful
`/api/ready` check at 2026-10-10T23:57:41Z. That confirms deployment/readiness of
the parent, not deployment of this follow-up or a successful location test.

## Architectural references reviewed

- [Scrapy DownloaderStats source](https://docs.scrapy.org/en/latest/_modules/scrapy/downloadermiddlewares/stats.html)
  separates request, response-status and exception accounting.
- [SpiderFoot correlation README](https://github.com/smicallef/spiderfoot/blob/master/correlations/README.md)
  distinguishes collected records, aggregation and subsequent analysis.

These references informed diagnostic boundaries only; no external engine or
connector was installed. Real account/device importers, source availability,
automatic photo acquisition, per-record contribution reporting, production
decoder verification and end-to-end location accuracy remain separate work.
