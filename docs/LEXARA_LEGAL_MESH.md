# Lexara legal mesh

Implementation date: 2026-09-28. Scope: LegalWhat/Lexara only. The platform-wide
17-participant Harmony registry remains available to other products.

## Request sequence

1. Software identifies fast conversation, deeper reasoning, or document drafting.
2. It checks shared provider availability and reserves capacity before dispatch.
   Selection combines task suitability, recent use, provider health and allowance.
3. Fast conversation starts one provider and adds a second after 600 ms if needed;
   the first valid answer cancels the other. Reasoning and drafting use up to two
   independent providers in parallel, then combine successful results. A single
   successful result does not incur an unnecessary synthesis call.
4. A limited or failed provider is skipped and another eligible company takes over.
   All five working providers participate over successive eligible requests;
   every request does not need all five. No routine route falls back to Claude.
5. Claude Sonnet is an exceptional reviewer when synthesis flags a material
   unresolved disagreement, or when an explicit difficult-review request is made.
   Software performs normal orchestration. Claude review failure retains the
   existing answer and its uncertainty rather than recursively spending credits.

## Current scoped models

Three tiers mean three task purposes, not three different models per vendor.
Reasoning and drafting can share a strong model while using different selection
priorities. These are routing choices, not a claim of proven legal superiority.

| Provider | Fast conversation | Deeper reasoning | Document drafting |
| --- | --- | --- | --- |
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` | `openai/gpt-oss-120b` |
| Google Gemini | `gemini-3.8-flash` | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` |
| Mistral | `mistral-small-latest` | `mistral-large-latest` | `mistral-large-latest` |
| Cohere | `command-a-plus-05-2026` | `command-a-plus-05-2026` | `command-a-plus-05-2026` |
| Direct OpenAI | `gpt-6-sol` | `gpt-6-astra` | `gpt-6-astra` |
| Claude | Exceptional review only: `claude-sonnet-5` | Exceptional review only | Exceptional review only |

Fast routing favors Groq/Cohere/Gemini; deeper reasoning favors Gemini/Groq/OpenAI;
drafting favors Cohere/Mistral/OpenAI. Capacity and aging can change the order.
Gemini Pro is explicitly a preview model. Mistral's official latest aliases follow
the vendor's current releases. Claude Opus 5.5 is catalogued but not automatically
used by the legal review path. Groq credentials go only to Groq; direct OpenAI
uses its own credentials and Responses API transport.

The legal allowlist excludes Cloudflare, OpenRouter, Cerebras and duplicate
GPT-OSS/Claude-Opus participants. Recovery cannot reintroduce obsolete Gemini
catalog entries, legacy legal defaults or cross-provider model identifiers.
Historical documentation and other products' provider settings are not erased.

Model references checked on the implementation date:
[Claude](https://platform.claude.com/docs/en/models/overview),
[OpenAI](https://developers.openai.com/api/docs/models),
[Gemini](https://ai.google.dev/gemini-api/docs/models),
[Mistral](https://docs.mistral.ai/models),
[Cohere](https://docs.cohere.com/docs/command-a-plus),
[Groq](https://console.groq.com/docs/models).

## Rate limits and quota

There is no artificial daily/monthly usage or Claude spending cap. Optional
`LEXARA_<PROVIDER>_RPM`, `_TPM`, `_RPD`, and `_MONTHLY_REQUESTS` values must describe
real account allowances; unset values impose no such ceiling. Concurrency defaults
to one in-flight request per provider account and can be set with `_CONCURRENCY`.
This controls bursts, not total usage. Claude aliases share one account ledger.

Production uses PostgreSQL row locks and expiring leases, shared across instances.
The first request creates `public.lexara_provider_quota` through the application's
existing database connection. Its service database role needs schema-create and
table ownership privileges. RLS is enabled and PUBLIC access revoked. Only usage
counters, cooldowns and leases persist, never prompts or keys. If the ledger is
unavailable, legal dispatch is withheld to avoid uncontrolled spending.

Before calls, reserve the full requested output plus conservative prompt allowance.
Do not refund uncertain/cancelled calls. Capture remaining-allowance headers on
supported transports and honor Retry-After. Rate limits pause the account; billing
or daily exhaustion pauses it longer. Reservation failures and hedge cancellation
do not incorrectly trip provider failure circuits. Legal SDK retries are disabled
so the orchestrator owns retries, independent fallbacks and request deadlines.

Provider limits can still change, and unrelated consumers of the same credentials
are outside this ledger. The system reduces collisions and recovers from upstream
limits; it cannot guarantee that an upstream 429 will never occur.

## Validation

- `node scripts/test-lexara-provider-policy.cjs`: 64 mocked behavior checks.
- `node scripts/verify-ai-harmony-platform.cjs` and
  `node scripts/verify-lexara-realization.cjs`: platform and routing regressions.
- `npm run build:server`: server bundle.
- `PGLITE_MODULE=<test-only-package-path> node scripts/test-lexara-quota-store.cjs`:
  embedded PostgreSQL schema, shared-state and rollback checks. The adapter
  serializes transactions on its single connection; this is not a production
  multi-connection load test. Install `@electric-sql/pglite` separately for this
  optional test; it is not a production dependency.

No paid inference, production schema changes, merge or deployment is performed by
these checks. Live credential/model availability and production database privileges
still require deployment-environment verification.
