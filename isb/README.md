# ISB — Iron Smart Bubble

**Status: PASSIVE, isolated, not deployed, not merged.**

ISB is an independent, **out-of-path** monitor. This change implements a read-only observation layer and an advisory correlation layer. It is **not** a live firewall, traffic shuffler, honeypot, intrusion blocker, or a completed moving-target defense. The remaining shifting, decoy and containment layers are not yet implemented.

No LegalWhat application module imports ISB. No app routing, DNS, Square webhook, authorization, authentication, subscription, Supabase, Lexara, Spectra, service configuration, or active Railway production setting is modified. ISB only reports `action: "observe"`. It cannot grant or deny access. Existing authentication remains the only source of access decisions.

## One observation scope, four public addresses

- `legalwhat.com` and `bad-blue-production.up.railway.app` reach the same main Bad-Blue service.
- `lexara-ddgs-production.up.railway.app` and `lexara-openserp-production.up.railway.app` are supporting public search-service addresses; they are not login doors.
- Other inventoried support services do not currently have public Railway domains.

Signup/login is the intended user gateway, but Square notifications and existing technical integrations must remain operable. Incorrect passwords, repeated ordinary login mistakes, registration, trial events, and normal billing callbacks do not trigger attack decisions.

## Isolated implementation layers

1. `observer.cjs` — host inventory and passive recognition of known suspicious URL probes.
2. `normalize.cjs` — privacy boundary. Raw URL, query, IP, user agent, identity, credentials, headers, and body never appear in monitor results.
3. `mesh.cjs` — bounded per-minute correlation across all four hosts. Three or more suspicious probes in a valid single minute produce only an `operator-review` advisory; no enforcement.
4. `monitor.cjs` — reads bounded Railway JSON log lines from standard input, reports sanitized aggregate JSON, and makes no network requests.
5. `collect.sh` — operator-initiated, read-only Railway CLI snapshots. It asks the existing Railway edge for HTTP logs; it never sends requests to the application.
6. `observer.test.cjs` and `mesh.test.cjs` — negative cases, harmless authentication, Square, privacy, hostile input, and mocked Railway collection.

## Operation

Requires Node.js 20+, Bash, and an authenticated Railway CLI authorized to read the `adaptable-youth` production project's HTTP logs. **Do not commit tokens or exported raw logs.** Scope Railway credentials as narrowly as the provider supports.

- Run focused tests: `node --test isb/*.test.cjs`
- Syntax-check: `node --check isb/observer.cjs`, `node --check isb/normalize.cjs`, `node --check isb/mesh.cjs`, `node --check isb/monitor.cjs`, `bash -n isb/collect.sh`
- Offline replay of sanitized JSON lines: `node isb/monitor.cjs < example.ndjson`
- Optional manual read-only snapshot: `bash isb/collect.sh`

The collector requests the most recent 500 Railway HTTP entries for each of the three public services, covering the main site's two hostnames as a single service. It has **not** been scheduled, activated, or run against production through this change.

Raw Railway records briefly pass through process memory before being reduced to privacy-safe categories. ISB never writes or returns raw records. Do not pipe raw Railway output to files or issue reports. If any source fails, the collection command returns nonzero; any preceding output may be partial and **must not** be interpreted as a clean security result.

## Security and functional constraints

- Wrong passwords and normal user mistakes are not considered attack evidence by themselves.
- No WAF blocking, CAPTCHA, redirect, credential examination, source-IP based enforcement, or injected code in the request path.
- No new public listening port, database table, edge rule, DNS change, Square modification, or app build dependency.
- Railway Under Attack Mode is **not** enabled; it can reject nonbrowser Square callbacks and must not be automatically activated.
- Current path-probe rules are narrow. This is not a comprehensive vulnerability detector; sophisticated intrusions can evade it.
- A passive monitor cannot stop attacks. Moving-target and sacrificial bubble components require separate implementation and end-to-end testing.

## Merge / deployment gate

Only `isb/` files may be included in the diff. Execute the user's full ten-pass sequence with evidence: passes 1–5 whole-application functionality; pass 6 scope and regressions; passes 7–9 verifier correctness, including negative tests and deliberate fault injection; pass 10 whole-application functionality again. **Any failure restarts all ten.**

Functional tests must cover successful and failed login, new-user signup, the 72-hour free trial, paid signup, Square checkout and signature-validated callbacks, Lexara, Spectra, all connected search services, the main Railway hostname, and production readiness/latency. Running unit tests or reviewing source without live end-to-end validation does **not** satisfy these gates.

Create or update a clean review branch and PR only with verified source, then **notify the user before merging**. Never merge or deploy on the user's behalf until the user reviews this checkpoint. No assurance of literal 100% noninterference is made.
