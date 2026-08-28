# S-93 Durable Outbox Verification Contract

This branch is review-only and must not merge unless the S-93 implementation preserves the governing no-regression invariants.

Required behavior:
- terminal measured outcomes only;
- deterministic source event identity and dedupe key;
- private server-only durable queue;
- concurrent workers claim via `FOR UPDATE SKIP LOCKED`;
- stale processing leases recover after restart;
- bounded retry/backoff and terminal failed state;
- terminal sink remains idempotent by event id;
- outbox/database degradation never becomes execution, settlement, governance, or resource-admission authority;
- runtime heartbeat exposes backlog/retry/failed health;
- no hot market-data stream is written through this outbox.

This file contains no runtime code and exists only to make the review acceptance contract explicit.
