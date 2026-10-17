# ISB - Iron Smart Bubble

## Status: Bad-Blue in-process integration, passive by design

ISB is a passive, privacy-limited observer with randomized sacrificial decoy bubbles. The embedded mode runs inside Bad-Blue, with a single fail-open startup hook. It does NOT intercept, proxy, challenge, block, or change ordinary LegalWhat requests. Its "hard" containment acts ONLY on its own fake decoy paths; moving targets do not move production application code or routes. A passive observer cannot stop every real attack. LegalWhat continues to work if ISB fails.

Only a narrow startup hook in server/index.ts is added. No existing authentication, trial, Square, Lexara, Spectra, database, DNS, or Railway configuration logic is changed. Bad-Blue imports ISB, but ISB never imports or controls LegalWhat's application handlers.

## One observation scope

- legalwhat.com and bad-blue-production.up.railway.app: the same Bad-Blue application.
- lexara-ddgs-production.up.railway.app and lexara-openserp-production.up.railway.app: supporting public search services, not user login doors.
- Signup/login remains the intended user gateway. Square callbacks are necessary technical communications and must not be challenged.

## Implemented independent layers

1. observer.cjs: allowlisted host inventory and cautious URL-probe signatures.
2. normalize.cjs: strips raw URL paths, queries, credentials, cookies, IPs, user agents, and request bodies. Only minute-level and categorical telemetry survives.
3. mesh.cjs: bounded, cross-host probe-burst advisories; no actor identification or enforcement.
4. agent.cjs / run-agent.cjs: atomically read HTTP metadata using only the Railway CLI logs command. Salted SHA-256 request-ID deduplication is bounded in memory. Collection failure produces "unavailable", never a misleading partial result.
5. bubbles.cjs: 128 randomized virtual decoy cells by default, bounded between 5 and 2,048. Soft detections rotate decoy identities; direct serious decoy probes pop the targeted decoy and its neighbors; regeneration restores them. None of this affects legitimate application pathways.
6. decoy.cjs / run-decoy.cjs: isolated HTTP decoy returning a constant 404 except for independent health and fake robots.txt endpoints. It never forwards to LegalWhat, captures credentials, or retaliates.
7. constellation.cjs / run-isb.cjs: independent coordination; production-log advisories can rotate ONLY fake routes, while direct decoy probes can isolate ONLY decoy cells.
8. Dockerfile and Dockerfile.decoy: two separate images from root directory /isb. The private collector image has pinned Railway CLI 5.68.0, and no listening port. The public decoy image contains NO Railway CLI or collector. Neither is a Bad-Blue image. Container builds are not yet verified.
9. Test files: isolated behavior, privacy, fail-open, malformed-input, duplicate logs, Railway read-only commands, ordinary login/signup/Square fixtures, regeneration, and localhost integration.

## Embedded Bad-Blue operation (primary)

On startup, server/index.ts loads the built-in ISB middleware BEFORE registering the application's protected routes. Monitoring is enabled by default; ISB_EMBEDDED_DISABLED=1 is the emergency disable switch. If loading ISB fails, LegalWhat continues normally. Only the reserved `/__isb__/` path is handled by ISB; all other requests continue unchanged.

- Normal successful and failed logins, signup, 72-hour trial, subscriptions, Lexara, Spectra, and Square webhooks retain their existing handlers and responses.
- After completed responses, a bounded queue records only canonical route category, known hostname, HTTP method/status and minute of observation. Usernames, passwords, body, query parameters, cookies, IP and payment details are excluded. The queue has hard limits and drops data rather than delaying traffic.
- Recognized suspicious probes rotate decoy identifiers only. Repeated probes to ISB's reserved decoy paths can isolate/regenerate adjacent fake bubbles. This is deception/monitoring, **not production traffic blocking**.
- GET `/__isb__/robots.txt` provides decoy clues, and GET `/__isb__/healthz` returns a minimal `ok` health response. Existing `/robots.txt`, `/login`, `/api/*`, and application functionality are unchanged.
- Run: `node --test isb/*.test.cjs` and `node isb/embedded-express.verify.cjs` (the latter requires root project dependencies). The production bundle must contain the embedded-activation code. No new Railway service, Railway CLI, merchant tokens, DNS or routing configuration is required.
- Runtime status is reported in Bad-Blue logs as `[ISB] embedded passive monitor active`; aggregated counters are emitted approximately once per minute. Failures never change a client response.

## Legacy standalone operation (not required for embedded mode)

Requires Node.js 20 or newer. Railway log access requires authenticated Railway CLI and least-privilege Viewer authorization where possible. Never put a production write-capable token in an exposed decoy service.

- Tests: node --test isb/*.test.cjs
- Syntax: for f in isb/*.cjs; do node --check "$f"; done
- Bash syntax: bash -n isb/collect.sh
- Safe replay: node isb/monitor.cjs < sanitized-sample.ndjson
- One-shot Railway read: ISB_MONITOR_ISOLATED=1 node isb/run-agent.cjs --once
- Independently running observer: ISB_MONITOR_ISOLATED=1 node isb/run-agent.cjs --watch
- Loopback decoy: ISB_DECOY_ISOLATED=1 ISB_BIND=127.0.0.1 ISB_PORT=8085 node isb/run-decoy.cjs
- Integrated LOOPBACK-ONLY developer simulation: ISB_SERVICE_ISOLATED=1 ISB_BIND=127.0.0.1 ISB_PORT=8085 node isb/run-isb.cjs

The OPTIONAL standalone processes must run OUTSIDE the site's request path. The combined local run-isb.cjs coordinator is STRICTLY LOOPBACK-ONLY even with a public-binding flag, to prevent Railway log credentials from being colocated with a public decoy listener. A separate PUBLIC DECOY ONLY may bind using ISB_DECOY_ISOLATED=1, ISB_BIND=0.0.0.0, ISB_BIND_PUBLIC=1, but its image must contain no Railway CLI, production token, or access to LegalWhat's private services. The private observer may use Railway Viewer credentials but may NEVER expose an HTTP listener. The decoy hostname is not a login door or proxy to LegalWhat. Neither service has been deployed.

Railway HTTP logs may contain sensitive information. Consume their output in memory only; never retain raw records. Source errors, missing credentials, stalled builds, and ISB crashes must have no effect on LegalWhat.

## Mandatory ten-pass acceptance gate

Passes 1-5: real end-to-end functionality checking of both main addresses, valid and invalid logins, signup, 72-hour trial, immediate payment, Square checkout/signature-validated webhooks, Lexara, Spectra, search services, latency, and readiness.

Pass 6: scope and regression comparison: no application code or configuration changes and no imports outside isb/.

Passes 7-9: verifier accuracy including deliberate fault injection and source-byte restoration.

Pass 10: the final complete real-world functionality check.

A failure restarts all ten passes after repair. Passing ISB unit tests and inspecting a Git diff does NOT replace production login/payment tests. A 100 percent mathematical noninterference guarantee is not possible.

**For future merges, verify preserved functionality, exact file scope and detector correctness, then notify the owner immediately BEFORE merging.** Live checkout and user-account acceptance testing remains the owner's responsibility. The embedded mode becomes operational only when the containing Bad-Blue build is deployed successfully; it is not a full WAF.

## Explicitly excluded

No Railway Under Attack Mode (could block nonbrowser Square callbacks), no DNS modifications, login/password processing, subscription changes, application binary shuffling, service restarts, IP-based tracking, production response changes, or retaliation. Production traffic filtering is NOT part of this implementation.
