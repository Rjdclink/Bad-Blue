# ISB - Iron Smart Bubble

## Embedded Bad-Blue integration and optional standalone mode

**Embedded mode:** Bad-Blue installs the ISB adapter once in its existing Express server before ordinary application routes. It performs bounded, post-response observation only for known suspicious URL probes, and serves fake moving decoys solely under the reserved `/__isb__/` prefix. The genuine `/robots.txt`, authentication, free trial, payments, Lexara, Spectra, and all ordinary routes are unchanged. Ordinary wrong passwords do not trigger it. Its soft/hard responses rearrange or isolate **fake cells only**; it never blocks, proxies, challenges, or redirects application traffic. It fails open if unavailable. This is a conservative supplementary detector and decoy—not a general WAF and not a guarantee of preventing attacks.

The only application-code integration is a guarded ISB import/installation in `server/index.ts`. Everything else is in `isb/` and a dedicated Express fixture verifier, `scripts/verify-isb-embedded.cjs`. No new Railway service, public port, credentials, DNS, or provider changes are needed. A separate standalone observer and standalone decoy are retained as optional alternatives but are not required or started by embedded mode.

## One observation scope

- legalwhat.com and bad-blue-production.up.railway.app: the same Bad-Blue application.
- lexara-ddgs-production.up.railway.app and lexara-openserp-production.up.railway.app: supporting public search services, not user login doors.
- Signup/login remains the intended user gateway. Square callbacks are necessary technical communications and must not be challenged.

## Implemented layers

1. observer.cjs: allowlisted host inventory and cautious URL-probe signatures.
2. normalize.cjs: strips raw URL paths, queries, credentials, cookies, IPs, user agents, and request bodies. Only minute-level and categorical telemetry survives.
3. mesh.cjs: bounded, cross-host probe-burst advisories; no actor identification or enforcement.
4. agent.cjs / run-agent.cjs: atomically read HTTP metadata using only the Railway CLI logs command. Salted SHA-256 request-ID deduplication is bounded in memory. Collection failure produces "unavailable", never a misleading partial result.
5. bubbles.cjs: 128 randomized virtual decoy cells by default, bounded between 5 and 2,048. Soft detections rotate decoy identities; direct serious decoy probes pop the targeted decoy and its neighbors; regeneration restores them. None of this affects legitimate application pathways.
6. decoy.cjs / run-decoy.cjs: decoy-only HTTP responses. Embedded mode maps `/__isb__/robots.txt` and fake bait paths to this handler, without changing the real `/robots.txt` or real application routes. It never forwards to LegalWhat, captures credentials, or retaliates.
7. constellation.cjs / run-isb.cjs: independent coordination; production-log advisories can rotate ONLY fake routes, while direct decoy probes can isolate ONLY decoy cells.
8. Dockerfile and Dockerfile.decoy: two separate images from root directory /isb. The private collector image has pinned Railway CLI 5.68.0, and no listening port. The public decoy image contains NO Railway CLI or collector. Neither is a Bad-Blue image. Container builds are not yet verified.
9. Test files: isolated behavior, privacy, fail-open, malformed-input, duplicate logs, Railway read-only commands, ordinary login/signup/Square fixtures, regeneration, and localhost integration. `scripts/verify-isb-embedded.cjs` performs additional real Express regression tests.

## Safe local operation

Requires Node.js 20 or newer. Railway log access requires authenticated Railway CLI and least-privilege Viewer authorization where possible. Never put a production write-capable token in an exposed decoy service.

- Core tests: node --test isb/*.test.cjs
- Embedded app integration tests (run from repository root): node --test scripts/verify-isb-embedded.cjs
- Syntax: for f in isb/*.cjs; do node --check "$f"; done
- Bash syntax: bash -n isb/collect.sh
- Safe replay: node isb/monitor.cjs < sanitized-sample.ndjson
- One-shot Railway read: ISB_MONITOR_ISOLATED=1 node isb/run-agent.cjs --once
- Independently running observer: ISB_MONITOR_ISOLATED=1 node isb/run-agent.cjs --watch
- Loopback decoy: ISB_DECOY_ISOLATED=1 ISB_BIND=127.0.0.1 ISB_PORT=8085 node isb/run-decoy.cjs
- Integrated LOOPBACK-ONLY developer simulation: ISB_SERVICE_ISOLATED=1 ISB_BIND=127.0.0.1 ISB_PORT=8085 node isb/run-isb.cjs

**Embedded mode:** The existing Bad-Blue listener is reused. Requests to normal URLs proceed through their original Express routes. No Railway CLI, API key, worker, separate port, or standalone ISB service is started. An explicit `ISB_DISABLED=1` flag disables integration if necessary. The middleware reads only the request host, method, and path; it never reads request bodies or credentials. It observes known probe requests after the response finishes. The dynamic decoy responds only on the reserved `/__isb__/` namespace.

**Optional standalone mode:** `run-isb.cjs` remains strictly loopback-only to avoid exposing Railway credentials. The separate public decoy can bind only when explicitly configured, and must contain no Railway CLI, production token, or private network access. Neither standalone service is required for embedded mode.

Railway HTTP logs may contain sensitive information. Consume their output in memory only; never retain raw records. Source errors, missing credentials, stalled builds, and ISB crashes must have no effect on LegalWhat.

## Mandatory ten-pass acceptance gate

Passes 1-5: real end-to-end functionality checking of both main addresses, valid and invalid logins, signup, 72-hour trial, immediate payment, Square checkout/signature-validated webhooks, Lexara, Spectra, search services, latency, and readiness.

Pass 6: scope and regression comparison: the only existing application edit is the guarded ISB attachment in `server/index.ts`; no authentication, Square, subscription, Lexara or Spectra implementation is edited.

Passes 7-9: verifier accuracy including deliberate fault injection and source-byte restoration.

Pass 10: the final complete real-world functionality check.

A failure restarts all ten passes after repair. Passing ISB unit tests and inspecting a Git diff does NOT replace production login/payment tests. A 100 percent mathematical noninterference guarantee is not possible.

**Review before merging:** Record all relevant automated checks and the owner-requested ten verification passes, notify the owner before any merge, and reserve final real-world user-login, registration, checkout, Lexara and Spectra journeys for owner acceptance testing. The standalone ISB services remain optional and are not started by the embedded integration. Do not claim that passing fixtures provides a mathematical guarantee of zero runtime impact.

## Explicitly excluded

No Railway Under Attack Mode (could block nonbrowser Square callbacks), no DNS modifications, login/password processing, subscription changes, application binary shuffling, service restarts, IP-based tracking, production response changes, or retaliation. Production traffic filtering is NOT part of this implementation.
