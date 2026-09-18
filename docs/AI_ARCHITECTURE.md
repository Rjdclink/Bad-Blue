# LegalWhat AI Architecture

## Canonical authority

The platform uses one current-model registry: `server/aiHarmonyModelRegistry.ts`. It defines the 17 logical Harmony participants, their current model IDs, configuration probes, and capability declarations. Runtime services must not maintain a second provider-priority table or stale model catalog.

Harmony is a **capability pool**, not a requirement to call every model on every request. A task advertises what it needs—legal analysis, verification, research, structured output, long context, coding, multimodal input, fast chat, or deep reasoning—and `server/aiCollaborationOrchestrator.ts` selects the smallest healthy subset that covers those capabilities. Other configured participants remain available for tasks where their strengths fit and for route-local recovery.

## Current model defaults

Environment overrides remain authoritative. These are the canonical defaults as of 2026-09-18:

| Logical participant | Default model | Typical capabilities |
|---|---|---|
| Gemini | `gemini-3.8-flash` | fast chat, research, long context, multimodal, structured output |
| Claude | `claude-sonnet-5` | legal analysis, deep reasoning, verification, coding |
| Claude Opus | `claude-opus-5` | deep legal/reasoning work, verification |
| Groq | `openai/gpt-oss-120b` | fast reasoning, coding, structured output |
| Mistral | `mistral-small-2603` | fast chat, coding, agentic work, structured output |
| DeepSeek | `deepseek/deepseek-v4.1-flash` | deep reasoning, coding, long context |
| Grok | `x-ai/grok-4.6` | reasoning, research, multimodal |
| Kimi | `moonshotai/kimi-k3` | reasoning, coding, long context, multimodal |
| Qwen | `qwen/qwen3.8-max-0902` | reasoning, coding, long context, structured output |
| OpenAI fast via OpenRouter | `openai/gpt-5.6-luna` | fast chat, legal analysis, structured output |
| GPT-OSS | `openai/gpt-oss-120b` | fast/deep reasoning, coding |
| OpenRouter auto | `openrouter/auto` | gateway-selected capability fallback |
| Hugging Face | `openai/gpt-oss-120b:fastest` | reasoning, coding, structured output |
| Cerebras | `gpt-oss-120b` | fast reasoning and coding |
| SambaNova | `MiniMax-M3` | fast/deep reasoning, coding, multimodal |
| Cohere | `command-a-plus-05-2026` | legal analysis, verification, research, structured output |
| Together | `openai/gpt-oss-120b` | reasoning, coding, agentic work |

## Orchestration rules

1. **Capability first.** Provider identity is never a preference signal by itself.
2. **Smallest sufficient subset.** Normal user turns use only the participants needed for the requested skills. Live LEXARA turns are intentionally bounded for latency.
3. **One final response authority.** Specialist outputs are evidence. A synthesizer produces the service response when synthesis is needed.
4. **Route-local failure.** One provider failing, throttling, or losing model access does not block unrelated routes.
5. **Circuit breaking.** Repeatedly failing routes cool locally instead of being retried on every turn.
6. **Bounded recovery.** A failed specialist gets at most one capability-matched alternate in the live path; no retry fan-out.
7. **Context neutral.** User vs. autonomous context affects urgency/telemetry, not a hard provider silo.
8. **Advisory ML.** Routing/ML workers may score capability fit, but they do not replace Harmony as execution authority.
9. **Grounding is specialized evidence.** Crawlers and web-search adapters provide evidence when the task needs current external facts; they are not global prerequisites.
10. **Service output stays task-shaped.** LEXARA answers directly and concisely; CryptoCrawler AI remains advisory to canonical economics/execution/settlement authorities.

## Core files

- `server/aiHarmonyModelRegistry.ts` — current model/capability authority.
- `server/aiModelSelector.ts` — capability scoring only.
- `server/aiCollaborationOrchestrator.ts` — task-scoped Harmony collaboration and route-local failover.
- `server/aiProvider.ts` — shared service entry point and direct transport adapters.
- `server/aiTokenGovernor.ts` — quota/accounting compatibility layer; not a routing authority.
- `server/legalModelOrchestrator.ts` — legal task metadata/consensus surfaces backed by Harmony.
- `server/services/mlnlp/mlRoutingWorker.ts` — advisory capability scoring backed by the canonical registry.

## LEXARA live behavior

LEXARA uses the same Harmony pool but optimizes the live conversational path for human turn-taking:

- a fast acknowledgement lane can speak once if deep analysis is not immediately ready;
- presence checks such as “are you still there?” are separate control turns and do not mutate the active legal question;
- later substantive turns are queued separately and analyzed in order;
- ordinary answers default to the direct answer plus only material explanation;
- grounded authority retrieval has a short conversational deadline and fails locally;
- TTS/STT full duplex remains available with echo/artifact rejection and user barge-in.

## Configuration

At minimum configure the providers you intend to make available. Harmony automatically excludes unconfigured participants.

```bash
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=...
HUGGINGFACE_API_TOKEN=...
CEREBRAS_API_KEY=...
SAMBANOVA_API_KEY=...
COHERE_API_KEY=...
TOGETHER_API_KEY=...
```

Model-specific environment overrides are supported by the canonical registry (for example `GEMINI_MODEL`, `CLAUDE_MODEL`, `CLAUDE_OPUS_MODEL`, `GROQ_CHAT_MODEL`, `MISTRAL_MODEL`, `DEEPSEEK_MODEL`, `GROK_MODEL`, `KIMI_MODEL`, and `QWEN_MODEL`).

## Regression guard

`npm run verify:ai-harmony` prevents stale active-runtime model IDs, context-based provider silos, and alternate execution authorities from silently returning.
