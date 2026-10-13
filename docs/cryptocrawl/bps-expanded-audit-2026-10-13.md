# Expanded BPS audit — 2026-10-13 UTC

Scope: price collection → route measurement → below-floor reduction → APE → capital/gas repricing → execution/settlement accounting → terminal reporting → manual power. This is an evidence-based inventory, not a claim that every possible defect has been discovered. No production power commands or transactions were issued.

## Production evidence

The running service identified its source as `a0742ad4f5a8e7b0d5f31bb95ea90da211a06a94`, deployment `880b7a7a-44d4-4346-bff8-ea257ac07b0f`. PR #1332 was still open/unmerged. Subsequent SPECTRA deployments had failed or were building, not evidence that BPS repairs were live.

- 00:42:04 UTC: receiver setup exceeded 30 seconds.
- 00:42:19 UTC: Arbitrum scan exceeded 45 seconds.
- 00:42:20 UTC: Ethereum configured route gas economics unavailable.
- 00:41:39 UTC: real APE log showed three Optimism candidates, best BPS −4.384266 before and after, zero uplift, zero resident improvements. This is activity without a measured improvement, not an executed profit.
- 00:43:22 UTC: recovery telemetry reported 6,732 structural candidates, 322 measured quotes, zero true-positive quotes. These are reported counters, not necessarily a single uniformly sampled cohort.
- 00:46:28 UTC: all four primary price providers had successful responses; CoinMarketCap had 13 rate-limit responses, while DexScreener/DefiLlama/CoinLore also supplied data. CoinGecko emergency calls were zero. The alternatives exist and work; aggregation/lifecycle defects can still prevent their results being useful.
- Resource-lease and settlement workers continued logging `CRYPTOCRAWLER_MASTER_POWER_OFF` failures while background price telemetry continued. This establishes inconsistent ongoing activity/availability, but does not alone establish whether the cause is incomplete stop, startup rollback, or duplicated state. Do not erase the OFF guard to hide it.
- Runtime readiness reported rejected OKX credentials and no spendable inventory. No credentials were changed or disclosed.

## Confirmed defects and selected resolutions

| Finding | Evidence / effect | Resolution and status |
|---|---|---|
| Degraded RPC recovery blocks healthy RPC selection | `getProvider` awaited every expired-cooldown probe before selecting a healthy source | Prior PR work: prefer healthy candidates, share recovery, bounded hedged reads |
| Transport waits exceed scan lifetime | ethers v5 default HTTP timeout is 120 seconds; chain watchdog is 45 seconds | Prior PR work: bounded transport and cancellation-owned reads; do not merely increase all timeouts |
| Quote lanes wait for slow siblings | Completed configured quotes waited at `Promise.all` for dynamic discovery | Prior PR work: independent completed-result handoff |
| Healthy chains wait for slow-chain cycle | Global cycle awaited all chain scans | Prior PR work: chain-local owned scans and overlap suppression |
| Initialization can complete after stop | Old asynchronous initialization had no generation/lifecycle guard | Prior PR work: abortable startup and owned quote subscriptions |
| Quote age could be renewed during conversion | Reconstructed opportunities could inherit a new timestamp | Prior PR work: preserve quote observation/expiry and graphless TTL |
| Below-floor reduction is disconnected | `runStageTwoZeroCapitalBpsReduction` had no runtime caller; active handoff discarded candidates at/below −10 BPS | Added separate raw below-floor reduction lane; existing >−10 Stage One rule unchanged; ready candidates do not wait for reduction |
| Below-floor reducer uses rounded BPS comparisons | Floating BPS comparison can miss exact base-unit improvements | Added exact cross-multiplied comparisons and future-dated provider evidence rejection |
| Below-floor quote search can outlive remaining candidate lifetime | Quote-size search previously waited for all calls without per-search cancellation scope | Added deadline-owned quote calls, publication cancellation guard |
| Below-floor improvements absent from terminal | Reducer had no `recordBpsActivity` call | Record measured before/after improvement as a requote; no synthetic progress rows |
| HTTP timeout ends at headers | `clearTimeout` ran before `response.json()` | Timer now covers body consumption; tested with hung response body |
| HTTP caller cancellation discarded | Helper overwrote `init.signal`; retry delay ignored cancellation | Compose request/caller signals, stop retries promptly, cancel discarded response body, cap retry-after delay |
| Startup blocks its own price dependency | Price mesh accepted only ON, although startup needs prices before reaching ON | Explicit market-data phase allows STARTING/ON only; OFF/STOPPING remain disallowed |
| Usable resident prices wait for refresh | `getLiveSymbolPrices` awaited refresh even when current evidence remained usable | Return fresh residents immediately and refresh in background; missing-symbol failure no longer discards other valid prices |
| Local cache reads can fabricate acquisition freshness | Timestamp recreated when handing cached prices into residency | Carry original acquisition-start timestamp through cache/coalescing into resident evidence |
| Price collection survives lifecycle changes | Provider client had no manual-power ownership, queued requests/late completions could outlive OFF | Abort in-flight price transports at OFF/STOPPING, stop queued dispatch, clear caches, reject old-generation completions |
| Gas-asset prices are not warmed | Resident plane warmed USDC/USDT only, while gas calculations need ETH/POL/BNB/AVAX | Warm native assets through the same coalesced bounded provider client |
| Fixes are not deployed | Verified live source differs from PR head | Keep separate source/deployment evidence; merge/deploy only after gates pass |

## Material issues still open — do not merge as “all issues resolved”

1. **Chain-specific gas accounting.** Early configured routes use a broad 1.4M-unit estimate and a multiplier rather than an exact prepared-transaction estimate. Some settlement paths use only `gasUsed × effectiveGasPrice`. OP Stack additionally charges L1 data and, where active, operator fees. A multiplier is not measured proof of these amounts. Resolution: one chain-aware fee adapter shared by selection, native spending reservation, sponsor liability, and terminal settlement; exact prepared-payload estimation; raw receipt fee fields; fail explicitly when required fee evidence is missing. Arbitrum's estimate already includes its L1 component, so do not add that component twice. This requires fork-aware fixtures and pre/post-transaction reconciliation; it was not silently replaced with an assumed zero or arbitrary smaller estimate.
2. **Provider market timestamp versus acquisition timestamp.** The new timestamp preservation fixes local cache re-aging, but acquisition time does not prove when a remote provider last updated its price. CoinGecko exposes `last_updated_at`; other providers need their own schema-specific provenance. Resolution: carry per-provider market timestamp when available, distinguish timestamp-unknown observations, age-check before economics, and keep slower aggregate USD prices separate from exact on-chain trade quotes. Never stamp an old upstream market price as newly observed market truth.
3. **Cross-runtime OFF consistency.** Investigate the observed continuing price/settlement/resource work and blocked OFF queries using start/stop command IDs and component phase snapshots. Resolution: one lifecycle generation across each worker and task; stop acknowledgment; abort queued and in-flight work; rollback must stop every started component. Existing read guards must stay in place. Price-client and discovery-owned cases are repaired, but whole-system closure is not yet proven.
4. **Account-specific fee and inventory evidence.** OKX rejected the configured credentials; Kalshi evidence lacked authenticated fee/depth/funding fields for several entries; no spendable venue inventory was reported. Resolution: verify account/region/product capabilities through the existing connector, reacquire exact fees/depth/inventory, and represent missing evidence as unavailable rather than zero. Restoring unavailable credentials requires account-owner action; do not infer usable balances or fee discounts.
5. **Validation/release blocker.** GitHub jobs for PR #1332 did not start because the account is billing-locked. Restore account eligibility, rerun CI against the exact head, resolve failures, then verify the deployed commit and runtime behavior. No bypass or merge was performed.

## Research method and rationale

Started from live timeout and missing-price failures, followed them into provider selection and HTTP body/cancellation behavior, broadened to price timestamps and rollup fee composition, then checked the downstream admission and terminal boundaries. Official sources support the selected mechanics; they cannot establish this deployment's profitability.

- ethers v5 HTTP timeout and retries: https://docs.ethers.org/v5/api/utils/web/
- ethers v5 fallback stall behavior: https://docs.ethers.org/v5/api/providers/other/
- Node cancellation composition: https://nodejs.org/api/globals.html#class-abortsignal
- Fetch headers/body cancellation distinction: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- CoinGecko upstream update timestamp: https://docs.coingecko.com/reference/simple-price
- OP Stack execution, L1 data, and operator fees: https://docs.optimism.io/op-stack/transactions/fees
- Arbitrum combined L1/L2 estimation: https://docs.arbitrum.io/build-decentralized-apps/troubleshooting-building
- Uniswap quote economics and route fees: https://docs.uniswap.org/whitepaper.pdf

Chosen approach: measured route/size alternatives plus accurate all-in costs, fast independent data sources, bounded lifetimes, and exact before/after accounting. Rejected shortcuts: inventing positive BPS, marking missing costs zero, lowering a profitability threshold to call a loss a success, waiting indefinitely, or treating advisory logs as executed trades.

## Verification

- 21 scan-lifecycle checks pass, including the new below-floor handoff and ready-candidate independence checks.
- 13 price/HTTP/reducer behavior checks pass. The actual Stage Two module produced a mocked −15 → +6 BPS successor, rejected future-dated provider evidence, retained the original when alternatives were worse, and recorded the measured change.
- Existing 24 BPS behavior checks pass; terminal-OFF, propagation, current quote-liveness, price-provider wiring, APE latency/floor, and gas-truth verifiers pass.
- Production server bundle generated successfully with the established Overflow-authority bundler.
- Local deployment preflight completed, including the final success marker, flash receiver compilation, and all four Ghost Wallet contract compilations.
- Repository-wide TypeScript/full build and hosted CI remain unproven; earlier local full build hit historical asset-download limits and TypeScript hit the default heap limit.
- All added behavioral tests replace external I/O. No application startup, live wallet, or transaction was used. Passing mocked improvements are not live-profit evidence.
