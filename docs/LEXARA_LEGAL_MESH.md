# Lexara legal provider routing

Updated 2026-09-28. This supersedes the earlier Claude-review-only design.

## Sequence

1. Check shared account allowance, in-flight requests and provider cooldowns.
2. Choose Claude Sonnet first when eligible. Gemini is the preferred supporting
   company; Groq, DeepSeek and Kimi remain supporting candidates.
3. For short conversations, start Claude and delay the supporting request by
   600 ms. The first usable response cancels unfinished work. For drafting and
   deeper analysis, use up to two independent accounts and synthesize successful
   contributions. One successful answer does not need an extra synthesis call.
4. Failed support requests prefer Claude as fallback if it is available and is
   not already running or failed for this turn. Never duplicate a running Claude
   call or override a provider's rate limit. Reserve a second attempt window in
   the overall deadline so recovery is not restricted to leftover milliseconds.
5. If all eligible services fail, report unavailability rather than fabricate law.

## Legal membership

- Claude: claude-sonnet-5, primary and fallback.
- Gemini: gemini-3.8-flash. The zero-quota Pro fallback is removed.
- Groq: openai/gpt-oss-120b replaces the blocked 20B default. A model-specific
  denial may try qwen/qwen3.8-27b once only when present in its live catalog.
  Catalog presence does not prove project permission; inference must succeed.
- DeepSeek: canonical deepseek/deepseek-v4.1-flash through OpenRouter.
- Kimi: canonical moonshotai/kimi-k3 through OpenRouter.

Mistral, Cohere, direct OpenAI, Claude Opus aliases, Cloudflare and generic
OpenRouter auto-routing are excluded from legal dispatch. Cerebras is excluded
from all Harmony dispatch; its transport and warmup probe are removed. Other
platform providers remain untouched.

## Quota protection and verification

DeepSeek and Kimi share one OpenRouter quota domain. Claude aliases share the
Anthropic account. Shared database leases, observed remaining allowance and
Retry-After cooldowns continue to apply. No artificial daily/monthly spending cap
is added. Concurrent external callers and provider-side changes mean rate-limit
avoidance cannot be guaranteed.

After catalog warmup, one sequential synthetic readiness request per process is
made to configured Groq, DeepSeek and Kimi, using the same admission control and
no user facts. Logs tagged LEXARA SupportReadiness state whether actual inference
succeeded. Catalog listing and a configured key are not recorded as inference
success. User-visible answer quality still requires acceptance testing.

## Evidence and checks

Production on Sep 28: Claude and Gemini previously returned successful answers;
Groq 20B was project-blocked; Gemini Pro reported zero quota. OpenRouter catalogs
list DeepSeek V4.1 Flash and Kimi K3, but current account inference remains to be
established after deployment. Do not label these candidates verified prematurely.

Run node scripts/test-lexara-provider-policy.cjs and
node scripts/test-lexara-document-handoff.cjs for isolated regression checks.
These use mocked provider I/O, not live account acceptance.
