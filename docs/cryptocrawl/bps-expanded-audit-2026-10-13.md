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
- Runtime readiness reported failed OKX authenticated requests and no spendable inventory. This does not establish that the key is invalid; region selection and credential loading must be distinguished. No credentials were changed or disclosed.

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

## Follow-up repairs — 2026-10-13 01:40 UTC

- Full type checking revealed the direct teardown exception: `stopEconomicTransformationWiring` referenced `stopUniversalBpsRescueCoordinator` without importing it. This threw before the later Ghost workers stopped. Import repaired; canonical teardown now attempts every stop hook and reports failures afterward.
- Failed startup now uses the complete ordinary stop path. Core shutdown also calls the previously omitted Rainbow/recipient-confirmation teardown. Startup/import continuations, Ghost startup/listener attachment, and settlement backfill are generation-owned; late completion cannot revive the old lifecycle. Independent Ghost controllers refuse OFF startup. Sponsor transports abort at OFF and reject subsequent requests.
- OP Stack native reservation now queries the deployed GasPriceOracle for L1 data and operator fees at one block. Receipt reconciliation includes matching raw `l1Fee` plus historical-block operator fees. Other chains retain their native receipt accounting; Arbitrum's L1 portion is not counted twice. Missing actual fee evidence is an error, not a fee-cap substitute or zero.
- Complete prepared native-fee reservations are checked against the selected opportunity's input-token gas budget before native submission on the flash, composite and alternative paths. Aggregate discovery gas budgets remain conservative estimates; they are not exact transaction measurements. OP additional-fee reservation includes a 2× estimate buffer, which is explicitly not an inclusion-time hard cap.
- Sponsored execution previously accepted `operation.success OR bundle.status=1`, and charged the full bundle receipt to the individual operation. APE and Ghost now require individual operation success AND successful bundle status. The three zero-capital prepared executors account for individual `actualGasCost` plus the configured billing surcharge, rounding up; missing per-operation cost cannot become zero. Contractual provider billing still requires valid account evidence.
- CMC, DefiLlama and CoinGecko market timestamps are retained separately from acquisition time. Execution USD evidence excludes stale, future-dated and undated observations; DexScreener/CoinLore undated prices remain available for non-execution display/benchmark aggregation. The default upstream USD age ceiling is 120 seconds, bounded to 1–300 seconds when configured, and resident acquisition TTL remains independently short. On-chain quote lifetimes are unchanged.
- Related runtime exceptions repaired: rate-limit error handling referenced an undefined `errorCount`; liquidation preparation referenced an undefined flash-fee variable; dashboard ladder routes lacked their state import. Sponsor runtime types now carry individual-operation cost and billing-surcharge capability. TypeScript's standard-library declarations now include ES2021 features already used by the Node runtime.

## Remaining release and operational limitations — not merged

1. **Hosted CI is blocked.** Current published-head run `38329946448` did not execute steps: GitHub states the account is locked due to a billing issue. The account owner must resolve billing; no payment or account change was made.
2. **Repository-wide type check is not green.** With an 8 GiB heap, the check completed instead of exhausting memory and reported 216 diagnostics (339 output lines) in files outside this follow-up repair. Remaining failures span other repository files, including pre-existing CryptoCrawler modules; full-build/CI success must not be claimed. Runtime-affecting undefined identifiers found in the touched BPS/gas/shutdown paths were repaired. This PR is not a general rewrite of all repository type errors.
3. **Account data is unavailable.** Live OKX authenticated requests failed and inventory/fee/depth evidence was missing on some venues. These failures do not establish a bad key. A hard-coded regional endpoint bypass in payout confirmation has now been repaired and the regional selector covers the documented official regional origins; account-specific success remains unverified on production. No credentials, balances, discounts or fee schedules were invented.
4. **Deployment validation remains outstanding.** Production still ran the older deployment while these changes were being prepared. At 01:28 UTC, logs still showed the old OFF-worker failures. No power command, application startup, trade, or live profitability experiment was issued. After CI and deployment, verify the deployed source and OFF egress; actual profitability requires real market evidence under a separately authorized running system.

## Research method and rationale

Started from live timeout and missing-price failures, followed them into provider selection and HTTP body/cancellation behavior, broadened to price timestamps and rollup fee composition, then checked the downstream admission and terminal boundaries. Official sources support the selected mechanics; they cannot establish this deployment's profitability.

- ethers v5 HTTP timeout and retries: https://docs.ethers.org/v5/api/utils/web/
- ethers v5 fallback stall behavior: https://docs.ethers.org/v5/api/providers/other/
- Node cancellation composition: https://nodejs.org/api/globals.html#class-abortsignal
- Fetch headers/body cancellation distinction: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- CoinGecko upstream update timestamp: https://docs.coingecko.com/reference/simple-price
- Pimlico individual operation success and actual gas cost: https://docs.pimlico.io/references/bundler/endpoints/eth_getUserOperationReceipt
- OP Stack fee estimation through the deployed oracle: https://docs.optimism.io/app-developers/guides/transactions/estimates
- OP Stack execution, L1 data, and operator fees: https://docs.optimism.io/op-stack/transactions/fees
- Arbitrum combined L1/L2 estimation: https://docs.arbitrum.io/build-decentralized-apps/troubleshooting-building
- Uniswap quote economics and route fees: https://docs.uniswap.org/whitepaper.pdf

Chosen approach: measured route/size alternatives plus accurate all-in costs, fast independent data sources, bounded lifetimes, and exact before/after accounting. Rejected shortcuts: inventing positive BPS, marking missing costs zero, lowering a profitability threshold to call a loss a success, waiting indefinitely, or treating advisory logs as executed trades.

## Verification

- 21 scan-lifecycle checks pass, including the new below-floor handoff and ready-candidate independence checks.
- 15 price/HTTP/reducer behavior checks pass. The actual Stage Two module produced a mocked −15 → +6 BPS successor, rejected future-dated provider evidence, retained the original when alternatives were worse, and recorded the measured change.
- 15 chain-fee, sponsored-receipt and shutdown behavior checks pass, including fail-through teardown and the missing rescue-stop import.
- Existing 24 BPS behavior checks pass; terminal-OFF, propagation, current quote-liveness, price-provider wiring, APE latency/floor, and gas-truth verifiers pass.
- Production server bundle generated successfully with the established Overflow-authority bundler.
- Local deployment preflight completed, including the final success marker, flash receiver compilation, and all four Ghost Wallet contract compilations.
- Repository-wide TypeScript completed with the failures described above; full build and hosted CI remain unpassed. Earlier local full build hit historical asset-download limits.
- All added behavioral tests replace external I/O. No application startup, live wallet, or transaction was used. Passing mocked improvements are not live-profit evidence.


## Power consistency and two-page navigation follow-up

Live evidence at 2026-10-13 11:18 UTC identified production source `a0742ad4f5a8e7b0d5f31bb95ea90da211a06a94`, active background workers, repeated MASTER_POWER_OFF database rejections, a stopped scheduler, and a main scan completed at 00:42 UTC. The repair branch was not deployed.

Changes:
- Master arrows contain exactly Lexara consent and CryptoCrawler Command. Old CryptoCrawler URLs render the same command dashboard for a master session. Other application routes were not deleted.
- Master startup awaits the faucet and canonical installation, checks the core, scheduler, both discovery controllers and bridge workers before reporting ON, and preserves cancellation across an interrupted start.
- Status reads compute readiness from current component flags without provider I/O. Missing components report DEGRADED. Failed stop hooks prevent a false successful STOPPED report.
- All independent stop callbacks execute even after synchronous failures. Added missing shutdown of the intelligence outbox, evidence subscription, readiness optimizer and zero-capital recovery observers.
- Public and private exchange sockets close on STOPPING/OFF. Pending connection/identity work cannot reopen them after restart. Private REST requests and response bodies abort with the power generation; queued private operations recheck their original generation.
- Discovery tasks inherit power cancellation. Old startup promises cannot be mistaken for a new zero-capital discovery start. Delayed faucet/telemetry work cannot reactivate stopped resources.
- Payout confirmation uses the shared OKX credential/region authority instead of hard-coded US requests. Region selection now includes official EEA and Turkey origins when no explicit origin is configured; public EEA streams follow the authenticated cached region.

Verification: 9 new mocked power/transport tests, 21 scan-liveness tests, 15 price/HTTP tests, 15 gas/lifecycle tests and 24 BPS tests (84 total); core lifecycle, master navigation and manual lifecycle verifiers; frontend Vite build; Overflow-authority server bundle; full deployment preflight with receiver and Ghost contract compilation. Tests use mock transports and do not start the production application or submit transactions. The environment runs Node 24; the repository targets Node 20, so hosted target-runtime verification remains required.

Research references: Node.js timer cancellation documentation (https://nodejs.org/api/timers.html), OKX regional API documentation (https://www.okx.com/docs-v5/), and OKX REST-domain changelog (https://www.okx.com/docs-v5/log_en/). A regional `50119` response is not sufficient evidence to call a key invalid.

Remaining limits: these code repairs do not prove production egress silence or successful live BPS improvement. Already-sent chain/venue requests cannot be recalled; existing ethers HTTP operations have their transport deadlines while continuations are cancelled. Profitability remains conditional on actual fee, liquidity and price evidence. Hosted CI and repository-wide TypeScript remain merge gates; do not merge or claim production fixed until these gates and deployed verification are resolved. No live power, credential, deployment or transaction change was made in this follow-up.

Final follow-up typecheck: 209 diagnostics remain across other repository files; none reference the files changed in this follow-up. Repository-wide typecheck is still failing.
