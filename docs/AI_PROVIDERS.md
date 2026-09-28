# AI Providers and Current Harmony Models

The canonical source of truth is `server/aiHarmonyModelRegistry.ts`. Do not copy model IDs into service-local fallback tables. Environment variables may override defaults without changing service code.

## Current 17 logical participants

| Participant | Default model | Transport |
|---|---|---|
| Gemini | `gemini-3.7-flash` | Google |
| Claude | `claude-sonnet-5` | Anthropic |
| Claude Opus | `claude-opus-5` | Anthropic (same account as Sonnet) |
| Groq | `openai/gpt-oss-120b` | Groq |
| Mistral | `mistral-small-2603` | Mistral |
| DeepSeek | `deepseek/deepseek-v4.1-flash` | OpenRouter |
| Grok | `x-ai/grok-4.6` | OpenRouter |
| Kimi | `moonshotai/kimi-k3` | OpenRouter |
| Qwen | `qwen/qwen3.8-max-0902` | OpenRouter |
| OpenAI fast | `openai/gpt-5.6-luna` | OpenRouter |
| GPT-OSS alias | `openai/gpt-oss-120b` | Groq (not an independent route) |
| OpenRouter auto | `openrouter/auto` | OpenRouter |
| xAI | `grok-4.6` | xAI |
| Cloudflare | `@cf/openai/gpt-oss-120b` | Workers AI; requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN` |
| Fireworks | `accounts/fireworks/models/gpt-oss-120b` | Fireworks |
| Cohere | `command-a-plus-05-2026` | Cohere; requires `COHERE_API_KEY` |
| Together | `openai/gpt-oss-120b` | Together |

## LegalWhat provider policy

LegalWhat admits direct Claude, Groq, Gemini, Cohere, Cloudflare, and Mistral transports only. It excludes OpenRouter, Cerebras, and every gateway alias. A missing credential, exhausted allowance, or provider-side zero limit removes that route from live selection. Claude is billable, so daily request admission is capped; its remaining credits are determined by Anthropic responses rather than inferred from the presence of a key. Only one provider normally handles a short turn. A second independent provider may hedge a slow answer after 600 ms; substantive legal work can use two distinct transports. Per-provider admission leaves headroom below published free allocations and observes provider errors, but other applications sharing a key can consume the same account allowance.

## Use

Services call the shared AI/Harmony entry points and describe required capabilities. The orchestration layer selects a small healthy subset. It is intentionally incorrect to send every user turn to all 17 models.

Direct provider adapters exist only as transport mechanisms beneath Harmony or for provider-specific diagnostics. A service should not establish its own global provider preference, mandatory model, or fixed fallback chain.

## Failure behavior

- 429/quota/auth/model failures are local to that provider.
- Provider cooldowns prevent immediate repeated failures.
- Live tasks use bounded deadlines.
- One capability-compatible alternate is enough for live route recovery.
- The final user answer is produced once, not once per provider.

## Validation

Run:

```bash
npm run verify:ai-harmony
npm run verify:lexara-realization
```

Those checks verify the current registry, stale-model exclusions in active runtime files, and LEXARA/Harmony behavioral invariants.
