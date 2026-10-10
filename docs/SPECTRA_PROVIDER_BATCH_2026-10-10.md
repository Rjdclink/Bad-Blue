# Spectra provider recovery batch — 2026-10-10

This batch follows deployed commit `0b2dce6de2c53d9c9c11afc2c7033c82f02e0d2f`.
It repairs transport reliability, provider contracts and diagnostic accounting.
It does not change identity matching, evidence qualification or location inference.

## Confirmed findings

| Area | Evidence | Repair / validation |
| --- | --- | --- |
| DDGS offline | Deployment `1d6f9e5d-0946-4358-b1dd-f6a55cf06bc0` passed its healthcheck and served HTTP 200 searches; it was removed on October 10 at approximately 14:09 UTC. | Restore the service with its current IPv4 start command, explicit port 4479 and `/health`. Earlier failed startup records are not the current outage's cause. |
| OpenSERP offline | Deployment `d12924ff-5a86-4072-aa21-39c47ea56516` passed healthcheck, served both successful searches and parser failures, then was removed at approximately 14:10 UTC. | Restore service on port 7000 with `/health`; preserve raw HTTP mode, trusted CA certificates and TLS verification. A healthy process alone does not prove a healthy search engine. |
| SearXNG offline | Deployment history includes removed deployment `741e97e9-6ca5-4692-8df0-432dc7c172ad`; there is no currently serving deployment. Its retained runtime logs are empty. | Restore service on port 8080 with `/healthz`, then check JSON search independently. Do not claim it was never deployed or assert an unsupported startup root cause. |
| Repeated outage calls | The earlier self-test recorded 164 DNS failures per self-hosted provider. | Temporary provider cooldown for DNS, connection and missing-endpoint errors; bounded cooldown for repeated transient failures; preserve CAPTCHA exclusions and Retry-After. |
| Queue starvation | The HTTP deadline started before acquiring one of two provider slots. | Separate bounded queue wait from the request deadline; limit waiting jobs to 16 per provider; report admission skips explicitly. |
| ScrapingBee HTTP 400 | Five failures in the earlier run; adapter used generic HTML page scraping of Google. | Use documented `/api/v1/google`, `search`, bearer authorization and `organic_results`. The exact original HTTP 400 body was not inspected, so endpoint mismatch is a confirmed integration defect, not a proven explanation for every 400. |
| Error responses treated as empty | Missing arrays, malformed JSON and several upstream error paths silently became zero results. | Validate response contracts; distinguish errors, valid empty results, partial coverage and disabled engines. |
| Common Crawl | Collection HTTP failures were hidden; the historical-query regex did not match “history” or “historical”; partial results could be lost. | Preserve failures, recognize intended history terms, retain valid rows when another host/row fails, and flag partial coverage. |
| SerpAPI | HTTP 200 can carry either an upstream error or a documented successful empty response. | Check structured success/empty state before classifying the error field. |
| Logs | Raw OpenSERP engine error strings could enter coverage logs. | Emit bounded counts/categories only. Never include provider bodies, queries, keys or request URLs. |

## Accounting and limits

The compatibility scope remains `discovery-http`, with explicit
`countingUnit: provider-attempt`. These are not counts of unique sources, verified
evidence, or individual HTTP exchanges. A Common Crawl provider attempt can make
several HTTP requests. `dispatched` counts admitted provider work; `partial`
records responses with known coverage loss. Queue rejection, queue expiry,
cooldown and cancellation make coverage incomplete.

Admission control can skip work during overload. It does not claim complete
internet coverage. Healthy services, present keys and successful generic searches
cannot establish that sufficient recent location evidence exists.

## Verification before deployment

- 17 provider runtime checks: outage fan-out, queue deadline separation,
  cancellation, request contracts, malformed responses, partial results,
  authentication failure, challenge exclusion and exclusion rechecks after queueing.
- 9 request-diagnostic checks and 8 configuration/key-alias checks.
- 31 research-routing checks; native background investigation suite.
- 134 Spectra structural checks and 35 production invariants.
- Deployment-check fixture verifies bounded calls, credential alias handling,
  health-failure short circuit and secret-free logs.
- Docker is unavailable in this workspace. Container startup and real credentials
  require Railway verification; mocked checks do not establish those outcomes.

## One deployment batch

Pin the application and all three internal search services to the same reviewed
commit. Set only nonsecret service ports and the application's three internal
service URLs. Preserve the existing schema pre-deploy command, then append
`node scripts/check-spectra-providers.cjs`.

The deployment check makes at most one health request and one search request per
self-hosted service, plus one search per configured keyed provider. Each request
has a 10-second deadline and no retry. The fixed public query is “NASA Worldview
documentation”. It logs status, phase, elapsed time and result counts only.
External search failures are reported for review without taking the serving
application offline. No public provider ports, new API keys, GitHub Actions or
Railway AI agent are required.

After deployment, verify all service replicas, the application's readiness,
the deployment-check results and a fresh map load. Any unresolved upstream or
credential failure remains an explicit open issue. The earlier NASA 2D map and
attribution checks passed; actual 3D rendering on the user's phone remains
unverified because the available browser used its rendering fallback.

## Primary references reviewed

- https://github.com/deedy5/ddgs — documented `/health`, `/search/text` and CLI host/port.
- https://github.com/karust/openserp — Docker entrypoint, raw server and `/mega/search` response contract.
- https://docs.searxng.org/admin/installation-docker.html — current container/Granian configuration.
- https://docs.railway.com/guides/healthchecks — healthcheck port uses `PORT`; startup health is not continuous monitoring.
- https://docs.railway.com/networking/private-networking — environment-scoped internal service names.
- https://www.scrapingbee.com/features/google/ — dedicated Google JSON search endpoint and bearer authorization.
- https://serpapi.com/api-status-and-error-codes — successful empty response can include an error field.
