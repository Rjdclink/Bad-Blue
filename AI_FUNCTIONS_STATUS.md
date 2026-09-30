# AI Functions Status — Harmony Current

## Current state

AI-powered services are no longer “Gemini-only” or split into fixed user/autonomous provider silos. They enter the shared capability-driven Harmony layer. The canonical model registry is `server/aiHarmonyModelRegistry.ts`, which currently defines 17 logical participants.

## Service behavior

- **LEXARA legal conversation** — capability-matched legal/reasoning/verification subset with one concise final response, grounded authority retrieval when needed, and a live acknowledgement/control lane.
- **Officer/OSINT analysis** — grounded search/evidence adapters feed Harmony analysis; no Groq-only or Gemini-only authority.
- **Legal fact checking** — Harmony collaboration plus source-verification requirements; model agreement is not treated as legal proof.
- **Legal document/analysis utilities** — use shared Harmony entry points; ML routing is advisory.
- **CryptoCrawler AI analysis** — uses Harmony as advisory intelligence only; canonical deterministic economics/execution/settlement remain authoritative.
- **Background/autonomous work** — uses the same configured capability pool; one provider quota cannot globally block autonomous work.

## Canonical current defaults

Gemini `gemini-3.8-flash`; Claude `claude-sonnet-5-5`; Claude Opus `claude-opus-5-5`; Groq `openai/gpt-oss-120b`; Mistral `mistral-small-2603`; DeepSeek `deepseek/deepseek-v4.1-flash`; Grok `x-ai/grok-4.6`; Kimi `moonshotai/kimi-k3`; Qwen `qwen/qwen3.8-max-0902`; OpenAI fast via OpenRouter `openai/gpt-5.6-luna`; plus the canonical GPT-OSS, OpenRouter-auto, Hugging Face, Cerebras, SambaNova, Cohere, and Together participants in the registry.

## Invariant

All 17 participants are available to the platform according to configuration and health, but an individual task uses only the smallest appropriate capability-matched subset. This avoids needless latency, quota burn, and cascading provider failures while preserving the collective skills of the full pool.

## Verification

```bash
npm run verify:ai-harmony
npm run verify:lexara-realization
```
