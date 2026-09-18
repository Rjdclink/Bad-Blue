# LEXARA conversational reliability implementation review — 2026-09-18

## Sources — exactly 10

1. MDN — SpeechRecognition speechend event: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/speechend_event
2. MDN — SpeechRecognitionResult isFinal: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal
3. MDN — MediaTrackSettings echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation
4. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
5. ElevenLabs — Streaming text to speech: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
6. OpenRouter — Model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
7. Anthropic — Model deprecations: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
8. Groq — Supported models and Models API: https://console.groq.com/docs/models
9. Mistral — First API request / 429 handling: https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request
10. Supabase — Connect to Postgres / transaction pooling: https://supabase.com/docs/guides/database/connecting-to-postgres

## Production evidence cross-check

- Production committed the fragment "I was" as a complete user turn and started legal reasoning before the continuation "I was in Logan Iowa" arrived.
- ElevenLabs opened the observed stream in about 159 ms and the full media request completed through Railway in under a second, so the current severe choppiness is not explained by slow upstream TTS generation.
- Production Harmony repeatedly attempted a Groq model blocked at the project level, retired Claude model IDs, and a rate-limited Mistral route before reaching a successful response.
- Conversation persistence remains asynchronous but continues to fail at the database layer.
- The attorney image now returns actual WEBP bytes successfully in production.

## Implementation sequence

- Treat browser speechend/final-result events as evidence, not authoritative semantic turn boundaries.
- Prefer controllable server VAD + server STT on mobile, with verified microphone echo-cancellation settings where exposed.
- Increase silence tolerance and add incomplete-thought deferral so short narrative fragments are held for continuation.
- Preserve true barge-in, but require final echo-screened speech plus duration/confidence evidence before stopping LEXARA.
- Buffer the already-fast ElevenLabs stream on mobile before playback to remove network/media starvation from the audible path while retaining progressive playback on desktop.
- Restore ElevenLabs' standard 44.1 kHz / 128 kbps MP3 output for voice quality and emit playback-state telemetry to production.
- Correct stale/blocked provider model selection, dynamically discover Groq models, locally quarantine permission/rate-limit/model failures, and continue immediately through healthy Harmony alternatives.
- Use current active Claude model IDs and omit deprecated sampling controls where required.
- Keep persistence off the conversational critical path, retry transient database failures with backoff, and log the complete error chain for diagnosis.
- Extend the LEXARA regression gate to require complete-turn ownership, deliberate barge-in, mobile buffered playback, current provider models, route-local cooldowns, and the exact 10-source review.
