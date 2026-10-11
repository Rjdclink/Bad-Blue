# Spectra retrieval accounting — October 10, 2026

## Problem and release scope

The deployed retriever at `a86e5ac07a8c5dff8a7c393c0a48ceafbeb1f2fe`
returned `null` for multiple unrelated failure causes. Aggregate selected and
retrieved counts could identify missing pages but could not explain why they
were missing. A successful deployment or HTTP response did not establish
accepted location evidence.

This release adds diagnostic reporting to the existing bounded retrieval
operation. It preserves the returned evidence array, source selection,
timeouts, redirect and size limits, URL policy, extraction rules, evidence
admission and inference. It adds no collector, identity query, image acquisition,
retry, credential, source expansion or device/account connection.

## What changes

- Each selected target can report one finite reason: retrieved, cancelled,
  timeout, invalid URL, blocked URL, DNS error, HTTP error, redirect limit,
  missing redirect destination, unsupported content, oversized response,
  invalid response, or network failure.
- Last observed HTTP statuses are counted per page selection. They do not
  count every redirect response or claim that an HTTP success is usable evidence.
- A request-local ledger ignores duplicate completions and seals at the outer
  deadline. Missing completion reports remain explicitly unreported, without
  inventing their causes. Late callbacks cannot mutate the returned snapshot.
- The acquisition response, persisted pipeline summary and existing counts-only
  log receive these diagnostics. Public-venue responses also separate received
  records, distinct final URL strings, duplicate URL records, and address
  rejection reasons. Distinct URLs are not asserted to be independent sources.
- Existing evidence-status text explains failures and warns that page selections
  may repeat across search passes. Raw URLs, identities, response bodies,
  exception messages and credentials are excluded from the new diagnostics.

## References checked against the implementation

- [Scrapy DownloaderStats source](https://docs.scrapy.org/en/latest/_modules/scrapy/downloadermiddlewares/stats.html)
  separates request, response-status and exception counters. Spectra adopts
  separate outcomes with a smaller fixed vocabulary to avoid recording raw
  exceptions or arbitrary labels.
- [SpiderFoot correlation documentation](https://github.com/smicallef/spiderfoot/blob/master/correlations/README.md)
  distinguishes collected data from later correlation results. Spectra likewise
  keeps retrieval success separate from admission and inference.
- [Maltego Transforms SDK](https://github.com/MaltegoTech/maltego-transforms)
  documents typed inputs/outputs and request lifecycle middleware. The added
  optional diagnostic observer is typed and does not change the evidence-array
  return contract. The older `maltego-trx` repository is archived, so it was not
  adopted as a new dependency.

These are architectural references, not installed integrations. No external
repository code was copied into the implementation.

## Validation

- Eighteen new offline checks cover failure classifications, successful empty
  responses, historical publication time, redirect provenance, unchanged limits,
  cancellation, observer failures, deduplication, sealed snapshots, sanitized
  output, public-venue rejection and abstention.
- Eight pipeline checks include reserved retrieval time, stalled upstream work
  and diagnostics arriving after the returned deadline.
- The repository's full `verify:spectra` command passed, including existing
  public-venue conflicts, publication dates and evidence-provenance fixtures.
- Strict TypeScript checking passed for the changed retrieval, reporting,
  public-venue and client-notice modules.
- Local checks ran on Node 24; the repository declares Node 20 for production.
  The full local `npm run build` stopped in an unrelated existing contract
  compiler invocation: the sandbox denied the `tsx` CLI's IPC socket (`EPERM`),
  including when its temporary directory was placed in the workspace. No build
  gate or assertion was removed. Railway must execute the original build and
  readiness gates before any new production deployment is reported successful.
- The expected personal address was not added to source, fixtures or inference.
  Synthetic regression success is not a real-world location accuracy result.

## Remaining connection and verification work

Automatic device measurements need a supported provider connection and actual
measurements. Account-derived evidence needs an authorized importer and account
connection. Parser/adapter presence alone establishes neither. This release does
not claim that connecting any arbitrary account will supply location evidence.

Authenticated application-flow verification is separate from deployment health.
The original personal-location acceptance test has not been performed by this
release, and its outcome is not established by these diagnostics.
