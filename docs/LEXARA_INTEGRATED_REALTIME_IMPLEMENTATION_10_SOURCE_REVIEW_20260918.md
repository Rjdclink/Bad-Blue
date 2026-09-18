# LEXARA Integrated Realtime Implementation Review — 2026-09-18

## Scope

This implementation combines the existing LEXARA repair set with proven voice-agent and distributed-systems patterns. The change is deliberately grafted onto the current architecture: no provider becomes a new mandatory dependency, existing ElevenLabs/Groq/Anthropic/OpenRouter capability is preserved, and provider failures remain route-local.

## Sources — exactly 10

1. LiveKit — Turns overview: https://docs.livekit.io/agents/logic/turns/
2. LiveKit — Adaptive interruption handling: https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
3. Deepgram — Flux conversational STT quickstart/state model: https://developers.deepgram.com/docs/flux/quickstart
4. ElevenLabs — Realtime TTS WebSocket streaming: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
5. Groq — Production vs preview models and deprecation guidance: https://console.groq.com/docs/deprecations
6. Anthropic — Stop reasons and fallback handling: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
7. OpenRouter — Performance-aware provider routing principles: https://openrouter.ai/providers/apply
8. gRPC — Request hedging: https://grpc.io/docs/guides/request-hedging/
9. Envoy — Circuit breaking and retry budgets: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking
10. OpenTelemetry — Trace semantic conventions: https://opentelemetry.io/docs/specs/semconv/general/trace/

## Implementation sequence

1. Preserve the existing full provider/crawler capability pool and change only the user-facing LEXARA critical path.
2. Shorten fixed VAD/settle delays while retaining a longer incomplete-thought grace path.
3. Make substantive interruption cancel only the superseded generation and immediately hand ownership to the queued user turn.
4. Restore immediate non-semantic conversational acknowledgements for facts/questions while keeping them out of legal context.
5. Verify only suspicious generic STT closers with an independent second ASR path; do not double-transcribe ordinary speech.
6. Keep speech/TTS/preview models out of text-reasoning routes and quarantine project/terms-gated Groq models locally.
7. Treat catalog discovery as catalog eligibility, not proof of successful inference; runtime success promotes a provider to inference-ready.
8. Route the two selected legal specialists as a hedge: first usable result unlocks one synthesis authority while the slower specialist stops owning tail latency.
9. Rank otherwise capability-compatible providers with measured runtime latency/reliability while retaining circuit-breaker cooldowns.
10. Bound authority-research waiting on the live spoken path and emit stable per-stage timing telemetry.
11. Interpret Anthropic stop reasons before declaring a no-text response failed and make only one bounded recovery attempt for token exhaustion.
12. Stream short mobile replies immediately while retaining full buffering for longer replies where playback stability matters.

## Safety and regression invariants

- One synthesis authority remains responsible for the final user answer.
- Current legal authority is never invented when grounded research does not arrive inside the live latency budget.
- No new external service is required for LEXARA to function.
- Provider/model failure is local and does not globally disable the conversation.
- Suspicious-ASR verification is conditional, so ordinary STT latency does not double.
- Interruption cancellation applies to obsolete LEXARA work, not to the user's accumulated facts.
- No GitHub Actions or Railway preview deployment is introduced.
