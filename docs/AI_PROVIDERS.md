# AI Providers and Current Harmony Models

The canonical source of truth is `server/aiHarmonyModelRegistry.ts`. Do not copy model IDs into service-local fallback tables. Environment variables may override defaults without changing service code.

## Current 17 logical participants

| Participant | Default model | Primary transport/config |
|---|---|---|
| Gemini | `gemini-3.8-flash` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Claude | `claude-sonnet-5` | `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` |
| Claude Opus | `claude-opus-5` | Anthropic |
| Groq | `openai/gpt-oss-120b` | `GROQ_API_KEY` |
| Mistral | `mistral-small-2603` | `MISTRAL_API_KEY` |
| DeepSeek | `deepseek/deepseek-v4.1-flash` | OpenRouter |
| Grok | `x-ai/grok-4.6` | OpenRouter |
| Kimi | `moonshotai/kimi-k3` | OpenRouter |
| Qwen | `qwen/qwen3.8-max-0902` | OpenRouter |
| OpenAI fast | `openai/gpt-5.6-luna` | OpenRouter |
| GPT-OSS | `openai/gpt-oss-120b` | Groq/Cerebras/OpenRouter |
| OpenRouter auto | `openrouter/auto` | `OPENROUTER_API_KEY` |
| Hugging Face | `openai/gpt-oss-120b:fastest` | `HUGGINGFACE_API_TOKEN` / `HUGGINGFACE_API_KEY` |
| Cerebras | `gpt-oss-120b` | `CEREBRAS_API_KEY` |
| SambaNova | `MiniMax-M3` | `SAMBANOVA_API_KEY` |
| Cohere | `command-a-plus-05-2026` | Cohere or HF fallback |
| Together | `openai/gpt-oss-120b` | Together or HF fallback |

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
