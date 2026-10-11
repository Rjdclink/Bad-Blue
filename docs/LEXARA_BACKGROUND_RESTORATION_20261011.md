# Lexara background restoration — 2026-10-11

## Evidence and scope

The retained successful deployment was `414dbb53-66ee-4bb2-981d-06459d3af1f9`, commit `ac3569a8db7c7ebd91b554ddba2977f7e27f4c6e`. On 2026-10-08 at 02:55 UTC, two organization address checks completed in 5,484 ms and 6,741 ms, with four and three accepted sources and one research pass.

The failing production deployment was `765852d6-de96-40f9-a6b0-adfae2b6bf7f`, commit `fa670cd5b906cb5efef5da079c726432ad102b76`. Its 2026-10-11 00:47 UTC business turn recorded 15,124 ms total, 13,775 ms research, three passes and zero accepted sources. Retrieval 403/429 errors were also present. Logs do not quantify queue waiting for this turn.

Commit `c260c1fd17a0911352f637f56781fa38ec1d0b26` introduced a person-oriented ownership predicate for all business queries, rejecting every single-token subject. This defect already existed in the successful address-check baseline; an entire-version rollback would not repair it.

Commit `f1ef610076f5d5fa5fb2ae7d3f116387bc979943` moved queue waiting outside provider deadlines, permitting additional elapsed latency under contention.

## Restoration

- Merge the deployed production history through `fa670cd` with `develop` to retain both branches' improvements.
- Accept exact-subject organization/entity business descriptions without applying person-name or ownership requirements. Retain person ownership checks, evidence thresholds, negative-claim rejection and directory/noise protection.
- Count admission waiting toward provider elapsed deadlines, retaining bounded queues, concurrency caps, error classification and cooldowns. Queue-shortened timeouts do not penalize provider health.
- Exercise single-word and multiword organization evidence, unrelated directory descriptions, negative statements and substring names through the real investigation pipeline; sufficient official evidence must stop in one pass without paid fallback.
- Update stale verification expectations to reflect develop's existing low-effort Haiku policy, and load actual Spectra diagnostics/deadline dependencies in its routing harness.

The repair does not change research caps, source confidence thresholds or user data. While validation was running, a separate production deployment of subscription-access commit `8a963c81` started. Its access controls are preserved by merging that commit without changing them.

## Validation

Native background investigation suite passed, including new positive and negative cases. All 31 routing checks and 17 provider runtime checks passed. Provider-policy, Lexara realization, six-sequence and crawler-capability checks passed after reconciling their outdated expectations.

The full npm prebuild invocation is blocked locally by the sandbox denying the tsx CLI IPC socket. This is distinct from application compilation and does not justify disabling production gates. Deployment must run its normal build and healthcheck; a successful deployment alone does not establish live background-answer latency.

The application build gates and client, server and worker compilation passed locally. The subscription-access merge receives its own access-policy checks and recompilation before deployment.
