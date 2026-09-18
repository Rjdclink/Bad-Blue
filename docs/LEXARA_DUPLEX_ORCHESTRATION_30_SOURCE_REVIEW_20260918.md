# LEXARA duplex ownership and orchestration repair — 2026-09-18

## Pre-change capability baseline

- Production baseline commit: 2865572561f5c63275b6a000b65bf9aae8ed7894 (develop).
- Current production service is healthy; SEO-only changes since the last successful LEXARA deployment do not touch LEXARA voice, Harmony, attorney portrait, or persistence paths.
- Attorney-behind-desk WEBP loads correctly.
- ElevenLabs buffered mobile playback and full-quality mp3_44100_128 output remain active.
- Mobile voice currently uses server VAD + MediaRecorder + Groq Whisper/ElevenLabs Scribe fallback.
- User barge-in exists, but current VAD-only interruption can fire before transcript validation.
- Complete-turn buffering, unfinished-thought deferral, and route-local provider failover exist and must be preserved.
- Harmony capability-first routing exists with Claude, Groq, Mistral, DeepSeek, Grok, Kimi, and Qwen alternatives; Google/Gemini is not a LEXARA dependency.
- LEXARA durable history is routed through canonical Overflow and schema migration v29 is present.
- No GitHub Actions and no Railway preview deployment are introduced by this repair.

## Resolution sources — exactly 20

1. MDN — MediaTrackConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
2. MDN — SpeechRecognitionResult.isFinal: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal
3. OpenRouter — Latency and Performance: https://openrouter.ai/docs/features/latency-and-performance
4. ElevenLabs — Latency Optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
5. Anthropic — Model Deprecations: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
6. OpenRouter — Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
7. OpenRouter — Model Routing: https://openrouter.ai/blog/insights/model-routing/
8. MDN — MediaTrackSettings.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation
9. ElevenLabs — Stream Speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
10. ElevenLabs — Streaming Text to Speech: https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming
11. ElevenLabs — Realtime STT Transcripts and Commit Strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
12. MDN — HTMLMediaElement waiting event: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/waiting_event
13. Supabase — Connect to Postgres: https://supabase.com/docs/guides/database/connecting-to-postgres
14. MDN — SpeechRecognition speechend event: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/speechend_event
15. Groq — API Reference / Audio Transcriptions: https://console.groq.com/docs/api-reference
16. Express — Serving Static Files: https://expressjs.com/en/starter/static-files/
17. Groq — Supported Models: https://console.groq.com/docs/models
18. MDN — MediaRecorder dataavailable event: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event
19. Groq — Speech to Text: https://console.groq.com/docs/speech-to-text
20. MDN — HTMLMediaElement.play(): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play

## Implementation sources — exactly 10

1. MDN — MediaRecorder.requestData(): https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/requestData
2. ElevenLabs — Realtime STT Commit Strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
3. Groq — Model Permissions: https://console.groq.com/docs/model-permissions
4. Groq — Whisper Large V3 Turbo: https://console.groq.com/docs/model/whisper-large-v3-turbo
5. Anthropic — Messages Content Blocks: https://platform.claude.com/docs/en/api/typescript/messages
6. OpenRouter — Models API: https://openrouter.ai/docs/api/api-reference/models/get-models
7. OpenRouter — Web Search Server Tool: https://openrouter.ai/docs/guides/features/server-tools/web-search
8. Supabase — Drizzle: https://supabase.com/docs/guides/database/drizzle
9. MDN — MediaTrackSettings: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings
10. MDN — AudioWorklet: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet

## Chosen implementation sequence

1. Preserve every current working capability before touching endpointing or provider routing.
2. Remove transcript-unverified VAD-only interruption authority.
3. Keep interruption capability by taking a non-destructive MediaRecorder snapshot during sustained speech while LEXARA is speaking, transcribing that probe, and interrupting only when a strong non-echo transcript is confirmed.
4. Continue the full recording after the probe so the user never has to repeat the interruption.
5. Make generic acknowledgements poor barge-in evidence while LEXARA is speaking, but keep explicit "stop", "wait", "no", and longer high-confidence speech as valid interruptions.
6. Relax server STT rejection so long speech with clear no-speech evidence is not discarded solely because average log probability is low; aggregate no-speech evidence instead of using one worst segment.
7. Preserve 1.5-second server VAD and unfinished-thought deferral, which match current realtime STT guidance and already prevent the earlier fragment regression.
8. Constrain Groq to normalized, vetted capability-compatible production models; never fall through to an arbitrary catalog model such as groq/compound, and recursively quarantine permission-blocked models.
9. Parse all Claude text content blocks rather than assuming content[0] is text.
10. Replace the deprecated OpenRouter :online path for LEXARA authority research with the current openrouter:web_search server tool, and race it against Firecrawl instead of serially paying both failure latencies.
11. Keep route-local provider cooldowns and the existing Harmony analyst/verifier/synthesizer design.
12. Extend regression verification for duplex ownership, validated barge-in, long-speech acceptance, current provider adapters, current web-search tooling, attorney image, voice identity, Overflow persistence, and the exact 20+10 source review.

## Post-change capability matrix target

- Complete user turns: preserved/improved.
- Deliberate interruption: preserved, transcript-validated.
- Self-echo rejection: improved.
- Mobile microphone capture: preserved.
- Server STT Groq -> ElevenLabs fallback: preserved.
- ElevenLabs acoustic identity: preserved.
- Buffered mobile playback: preserved.
- Attorney image: preserved.
- Harmony provider breadth: preserved.
- Route-local provider failure: preserved/improved.
- Legal authority research: improved and current.
- Overflow history authority: preserved.
