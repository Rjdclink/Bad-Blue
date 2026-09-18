# LEXARA Intent Realization — Literal 30-Source Implementation Review
Date: 2026-09-18

This review cross-references the current LEXARA production regressions, voice architecture, AI-provider wiring, image presentation, and cross-device requirements against exactly 30 current primary/authoritative sources.

## Applied conclusions

1. Preserve browser SpeechRecognition where it is already proven reliable, but never treat it as universal. MediaRecorder/server STT remains a device-local fallback.
2. Raw VAD/acoustic energy is candidate speech only. It must not interrupt LEXARA. Interruption authority moves downstream to transcript evidence after echo rejection.
3. Reject low-evidence STT results before they can become conversation state, persistence, reasoning requests, or cancellation authority.
4. Use Groq verbose STT metadata (avg_logprob, no_speech_prob) as evidence, not merely non-empty text.
5. Preserve one acoustic identity: ElevenLabs only. Do not silently substitute an OS/browser voice.
6. Use ElevenLabs Flash and true streaming media delivery to lower time-to-first-audio.
7. Keep the paid ElevenLabs voice configuration inspectable/validatable and keep Scribe as an independent speech path.
8. Version conversation storage so corrupted/phantom historical voice turns are not silently reused after a speech-pipeline schema change.
9. Preserve the full attorney-behind-desk composition with object-fit: contain, fingerprint/cache-bust the asset, and provide render fallbacks.
10. Route LEXARA reasoning through the current platform model mesh first. Use OpenRouter Auto Router for current model selection/failover and retain direct providers only as route-local fallbacks.
11. Treat provider health as runtime state, not merely API-key presence; cool down invalid, blocked, connection-failing, or rate-limited paths.
12. Keep Groq STT health independent from Groq chat-model health.
13. Respect current provider lifecycle documentation: retired models must not remain defaults; rate limits are temporary health states rather than permanent provider removal.
14. Cross-device release truth requires actual device/browser behavior tests after compilation; compilation alone is not proof of microphone/echo behavior.

## Sources — exactly 30

1. W3C — Media Capture and Streams: https://www.w3.org/TR/mediacapture-streams/
2. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
3. MDN — MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
4. MDN — MediaStreamTrack.getCapabilities(): https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities
5. MDN — MediaStreamTrack.getSettings(): https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings
6. MDN — echoCancellation supported constraint: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/echoCancellation
7. MDN — noiseSuppression supported constraint: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/noiseSuppression
8. MDN — autoGainControl supported constraint: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/autoGainControl
9. MDN — AudioContext.resume(): https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
10. MDN — Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
11. MDN — CSS object-fit: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit
12. ElevenLabs — Realtime STT transcripts and commit strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
13. ElevenLabs — Client-side realtime Scribe streaming: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
14. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
15. ElevenLabs — Streaming concepts: https://elevenlabs.io/docs/api-reference/streaming
16. ElevenLabs — Stream speech endpoint: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
17. ElevenLabs — Text-to-Speech overview: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
18. ElevenLabs — Professional Voice Cloning quickstart: https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/professional-voice-cloning
19. ElevenLabs — Get voice: https://elevenlabs.io/docs/api-reference/voices/get
20. ElevenLabs — Get voice settings: https://elevenlabs.io/docs/api-reference/voices/settings/get
21. Groq — Speech to Text: https://console.groq.com/docs/speech-to-text
22. Groq — Model Permissions: https://console.groq.com/docs/model-permissions
23. Groq — Model Deprecation: https://console.groq.com/docs/deprecations
24. OpenRouter — Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
25. OpenRouter — Auto Router: https://openrouter.ai/docs/guides/routing/routers/auto-router
26. Google — Gemini API Models: https://ai.google.dev/gemini-api/docs/models
27. Anthropic — Claude API errors: https://platform.claude.com/docs/en/api/errors
28. Anthropic — Model deprecations: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
29. Mistral — Models: https://docs.mistral.ai/models
30. Hugging Face — Inference Providers: https://huggingface.co/docs/inference-providers/index
