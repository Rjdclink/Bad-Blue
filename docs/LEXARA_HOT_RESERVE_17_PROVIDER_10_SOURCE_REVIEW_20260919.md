# LEXARA Hot-Reserve Reliability Implementation Review — 2026-09-19

## Scope

This change cross-references the identified LEXARA root causes against current `develop`, recent LEXARA PR/branch history, production Railway logs, and exactly ten implementation sources. The invariant is that all 17 configured Harmony participants remain available as a hot reserve while only a small latency-first hedge is active on a normal turn. A single provider/model/transport failure must remain local and must not convert an otherwise serviceable turn into "live legal-reasoning service unavailable."

## Sources — exactly 10

1. gRPC — Request Hedging: https://grpc.io/docs/guides/request-hedging/
2. Envoy — Circuit Breaking: https://www.envoyproxy.io/docs/envoy/latest/configuration/upstream/cluster_manager/cluster_circuit_breakers.html
3. AWS Well-Architected — Set client timeouts: https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_client_timeouts.html
4. OpenRouter — Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
5. LiveKit — Adaptive interruption handling: https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
6. Deepgram — Endpointing: https://developers.deepgram.com/docs/endpointing
7. MDN — Fetch cancellation with AbortController: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
8. OpenTelemetry — Trace semantic conventions: https://opentelemetry.io/docs/specs/semconv/general/trace/
9. Anthropic — Stop reasons and fallback: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
10. Groq — Supported production models and Models API: https://console.groq.com/docs/models

## Implemented resolution sequence

1. Keep the canonical 17-provider registry intact and use every configured participant as eligible reserve capacity.
2. Launch only a three-route capability/latency/reliability-ranked hedge on a normal LEXARA legal turn.
3. On route-local failure, launch up to three rotated reserve routes instead of returning unavailable or waiting for all 17.
4. If every route is cooling, enter bounded recovery mode instead of treating cooldown state as a global outage.
5. Separate logical-provider health from shared transport-domain health so Anthropic, Groq, OpenRouter and other failure domains are tracked correctly.
6. Give inference-proven routes a ranking advantage over catalog-only routes without making cold-start catalog routes mandatory failures.
7. Return a complete successful legal-analyst answer directly; synthesis becomes a fail-local fallback for non-legal specialist winners rather than a mandatory second hop.
8. Introduce a distinct `legal-fast` strategy so legal rigor and fast-response intent no longer conflict in strategy selection.
9. Propagate browser disconnect/turn supersession into server orchestration, authority search and OpenRouter fetch cancellation.
10. Reduce OpenRouter's explicit user-facing timeout floor so a requested sub-four-second legal-turn deadline is actually honored.
11. Use current Groq production text models, exclude preview/speech models from the production recovery chain, and expire model-level permission blocks instead of poisoning the process indefinitely.
12. Log provider/model/transport/latency/error for failed Harmony routes so degraded turns identify the actual failing route.
13. Abort authority discovery after the conversational research budget rather than letting stale research continue behind the next turn.
14. Expose legal-reasoning readiness independently from microphone/TTS readiness.
15. Preserve phantom-closer suppression while permitting strong short intentional barge-ins such as "okay" or "yes" during playback.
16. Keep one canonical final LEXARA answer while making verification/synthesis fail-local rather than mandatory availability gates.

## Regression invariants

- No GitHub Actions.
- No Railway preview deployment.
- No provider becomes a mandatory single point of failure.
- No requirement to wait for all 17 participants.
- Legal authority is never invented when retrieval fails.
- A canceled/superseded turn must not cool a provider.
- Speech/TTS models must never enter the legal-reasoning route.
- A successful legal specialist result is preferable to a false global-unavailable response.
