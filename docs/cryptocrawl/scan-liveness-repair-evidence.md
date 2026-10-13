# BPS scan liveness repair

Production evidence reviewed: deployment `9b6016c8-9498-4d12-9ab2-6e46e899862a`, October 12, 2026, approximately 23:40–23:54 UTC. Logs reported repeated 45,000 ms canonical chain-scan watchdog failures. Public token discovery also reported HTTP 429 and provider-local historical-log restrictions. No live trading was started during this repair.

## Confirmed causes and repairs

| Cause | Repair |
| --- | --- |
| Every RPC request awaited recovery probes for degraded providers, even with a healthy provider available. Two sequential health probes could consume 24 seconds against a roughly one-second quote deadline. | Prefer healthy transports immediately. Share necessary recovery tasks. Use a bounded, delayed second independent provider for quote reads; cancel the unused hedge when the primary answers promptly. |
| Configured quotes waited for dynamic discovery before entering BPS rescue. | Each completed acquisition lane immediately enters the same measured rescue and provider-admission path. |
| Dynamic quoting waited for token scouting and recovery batches. | Quote existing templates immediately while refreshing structural discovery in parallel. Publish primary measurements before recovery work. Public and RPC scouts have independent bounded lifetimes. |
| The global cycle awaited every chain. | Chain tasks retain independent overlap protection; a slow chain cannot delay the next scan on healthy chains. |
| Timeouts released ownership but left asynchronous continuations able to retry and publish. | Propagate cancellation through discovery, RPC retries, sponsor HTTP requests, funding continuations, and candidate publication. Keep transport timeouts for already-issued ethers v5 HTTP requests. |
| Receiver setup was sequential across chains; repeated cycles installed duplicate fleet watchdog observers. | Prepare chains concurrently with one observer per fleet task. Preserve the configured submission receipt-wait budget. OFF cancels setup continuations. |
| Quote conversion and resident caching restarted evidence lifetimes after batch waits. | Preserve measured timestamps and expiration; retain the shorter graphless lifetime; reject expired rescue output before provider admission. |
| Native dynamic gas economics on four chains used the older single-source gas oracle with fixed fallback USD prices. | Use measured fee data and the existing live-price mesh for each native asset, with full token conversion and existing gas reserve factors. Unknown prices cannot become free gas. |
| Quote block subscriptions had no canonical stop/reset hook. | Stop their lifecycle signal, unsubscribe, invalidate late callbacks, and clear quote caches on OFF. |
| Some structural verifiers still inspected the pre-split executor filename or retired Alchemy policy shape. | Inspect the actual flash implementation and test the current Pimlico funding contract, including billed sponsorship, strict zero-cost mode, and native ownership proof. |

No Alchemy provider was added. Read hedging does not submit transactions. Existing execution, funding, positive-profit, and Stage-One admission boundaries remain in place. A positive result below +5 BPS remains acceptable under the existing economics rules; +5 is an optimization goal, not an execution requirement.

## Verification

- `node scripts/cryptocrawl/verify-scan-liveness-behavior.cjs`: 19 behavioral checks, using actual changed modules with mocked transports and no application startup.
- `node scripts/cryptocrawl/verify-bps-reduction-behavior.cjs`: 24 checks, including measured simulated recovery from -5 to +6 BPS and a two-pool fee/impact/gas scenario from -2.631566 to +10.3944 BPS. These are simulated results, not market observations or profits.
- Existing HTTP/WebSocket provider failover matrix: passed with the actual manager loaded through isolated dependencies.
- Dashboard state, OFF polling, terminal, manual lifecycle, canonical BPS propagation, resource admission, gas truth, and quote-liveness verifiers: passed.
- New cancellation-context TypeScript check: passed. The repository-wide TypeScript invocation exceeded the local default 2 GB heap; it is not reported as a passing check.
- `npm run build` completed deployment preflight, contract compilation, application verification suites, and the Vite frontend build. The subsequent browser-asset preservation step could not download historical production assets within its 180-second network deadline in this environment. The server and worker production bundles were therefore also built explicitly to separate output paths; both passed. The full npm command is not reported as a successful local exit. No application server was started.

The preflight now runs the new scan behavior, reducer behavior, and funding-contract verifiers automatically. Contract compilation uses `node --import tsx`, avoiding an unnecessary CLI IPC listener without skipping compilation.

## Practical limits

External providers can still be unavailable, rate-limited, or slow. The repaired system isolates those failures and continues with healthy paths; it cannot create a profitable market or prove an absent funding resource. Live quote-to-execution behavior was not activated for this repair. OFF means no new discovery/retry work; an ethers v5 HTTP request already sent before Stop can only finish or reach its configured transport timeout.

Implementation references checked: [ethers v5 connection timeout](https://docs.ethers.org/v5/api/utils/web/) and [Node AbortSignal](https://nodejs.org/docs/latest/api/globals.html).
