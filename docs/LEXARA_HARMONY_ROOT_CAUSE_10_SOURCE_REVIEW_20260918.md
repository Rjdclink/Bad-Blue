# LEXARA / Harmony — 10-Source Root-Cause Review (2026-09-18)

## Scope

This first pass cross-references the live repository/provider catalog against current provider documentation. The root issue is model-authority drift: service-local provider lists, fixed provider partitions, and hard-coded historical model IDs allowed different utilities to use different subsets and generations of the platform AI pool. The repair is one canonical current-model registry plus capability-driven Harmony participation.

## Findings applied

- Current model identity belongs in one registry, not duplicated service files.
- Provider health/failure is route-local; one unavailable provider must not collapse the mesh.
- Model selection is based on task capabilities (legal analysis, verification, coding, research, long context, multimodal work, structured output, and latency), not static provider rank.
- Service-local lists may express task requirements but may not exclude otherwise configured Harmony participants.
- Retired/legacy model IDs are replaced by current production-capable IDs or a current gateway router where a model family is intentionally abstracted.

## Sources — exactly 10

1. Anthropic — Model deprecations and current Claude model status: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
2. Google AI — Gemini API model catalog (Gemini 3.8 Flash / Live): https://ai.google.dev/gemini-api/docs/models
3. Groq — Supported production models (GPT-OSS 120B/20B and Whisper): https://console.groq.com/docs/models
4. Mistral — Model changelog (Mistral Small 4 / Medium 3.5): https://docs.mistral.ai/resources/changelogs
5. DeepSeek — API changelog (V4.1 Flash release and retired prior Flash IDs): https://api-docs.deepseek.com/updates/
6. xAI — Grok 4.6 API documentation: https://docs.x.ai/developers/grok-4-6
7. OpenRouter — Kimi K3 model route: https://openrouter.ai/moonshotai/kimi-k3-20260715
8. OpenRouter — Qwen3.8 Max (0902) model comparison/route evidence: https://openrouter.ai/compare/google/gemini-3.8-flash/qwen/qwen3.8-max-0902
9. Cohere — Command A+ current production model: https://docs.cohere.com/docs/command-a-plus
10. Hugging Face — Inference Providers and provider-selection routing: https://huggingface.co/docs/inference-providers/index

## Resolution

Use `server/aiHarmonyModelRegistry.ts` as the canonical current-model authority; make the shared AI Collaboration Orchestrator include every configured Harmony participant, assign roles from capabilities, keep provider failure local, and synthesize successful contributions through one final answer authority.
