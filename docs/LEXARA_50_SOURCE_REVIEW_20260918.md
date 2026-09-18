# LEXARA Live — 50-Source Implementation Review (2026-09-18)

## Purpose

This review cross-references the observed LEXARA production failures against 50 implementation sources covering browser media, full-duplex speech, barge-in, turn detection, TTS latency, streaming, and current AI-provider/model support. The implementation order is designed to remove failure amplification first, then restore natural conversation, then reduce latency without weakening legal-accuracy controls.

## Observed production failure groups

1. **Conversation transport:** microphone was suspended while LEXARA spoke, transcripts received during speech were discarded, and interruption depended on a manual button.
2. **Turn integrity:** duplicate finalized speech produced duplicate turns; a new turn aborted the previous client request while the server continued work.
3. **Acoustic identity:** ElevenLabs timed out client-side and silently fell back to browser voices, allowing accent/voice changes.
4. **Latency:** AI fallbacks were sequentially failing; database persistence blocked the response; TTS used a higher-latency whole-response path.
5. **Provider drift:** production referenced retired, inaccessible, or stale Gemini/Groq/Mistral/Claude/Cerebras/SambaNova model/configuration paths.
6. **Activation/permissions:** consent was a skippable modal, camera was unnecessarily coupled to voice, and audio-output unlock was not verified as part of the transition.
7. **Visual continuity:** the attorney-at-desk asset existed, but page-level auto-scroll moved it out of the mobile viewport.
8. **Architecture drift:** multiple legacy LEXARA surfaces and voice authorities existed beside the canonical conversation route.

## Cross-referenced implementation conclusions

### A. Consent and browser media must precede the live surface

Sources 1, 4, 6, 7, 8, and 9 support acquiring microphone permission through getUserMedia, requesting useful audio constraints such as echo cancellation, and using a user gesture to unlock media playback. Browsers do not expose a general-purpose speaker permission equivalent to microphone permission, so the correct implementation is a required user-gesture interstitial that obtains mic access and unlocks/verifies audio playback.

**Implementation:** every supported law-book route now enters a dedicated LEXARA consent/setup page before the consultation. Camera is not required. The page verifies microphone capture plus audio playback unlock before enabling live mode.

### B. Full-duplex recognition and barge-in replace the Interrupt button

Sources 2, 3, 5, 8, 39, 40, 41, 42, 44, 45, 47, and 49 consistently favor continuous/interim speech signals, explicit turn detection, and interruption handling for responsive voice agents. For LEXARA, recognition must remain active while TTS is playing. Interim human speech can stop playback immediately; finalized text is what advances the legal turn.

**Implementation:** the canonical conversation no longer suspends recognition during LEXARA speech and no longer discards transcripts solely because LEXARA is speaking. The manual Interrupt control is removed. Interim speech can trigger automatic barge-in; finalized text is buffered and submitted.

### C. Echo suppression is necessary when listening while speaking

Sources 1, 8, 9, 39, 40, 45, and 47 support acoustic echo cancellation and interruption discrimination as core duplex-agent concerns. Browser AEC is enabled and a lexical residual-echo guard compares recognized speech with the text currently being spoken so LEXARA does not interrupt herself on speaker leakage.

**Implementation:** echoCancellation, noiseSuppression, and autoGainControl remain enabled; a route-local self-echo guard filters high-overlap recognized output while preserving genuine user barge-in.

### D. Turn endpointing must be patient enough for legal conversation

Sources 39, 40, 41, 42, 45, 47, 49, and 50 show that end-of-turn behavior should be tuned to context rather than treating every short pause as a completed turn. Legal narratives often contain natural pauses.

**Implementation:** the quiet-window buffer was increased, duplicate finalized segments are suppressed, interim speech does not itself submit a legal turn, and finalized segments within a single natural utterance are accumulated.

### E. One acoustic identity requires one speaking authority

Sources 10, 12, 13, 17, 18, 20, 22, 23, and 24 emphasize explicit voice/model selection, streaming/low-latency modes, and stable speech configuration. A browser SpeechSynthesis fallback cannot guarantee the same voice across Android/iOS/desktop and was the observed source of accent switching.

**Implementation:** live LEXARA speech is pinned to the configured ElevenLabs voice. A TTS failure now leaves the consultation in text instead of silently changing to a device voice. The server default is moved to the low-latency Flash v2.5 model, and the client timeout is lengthened so valid synthesis is not abandoned just before completion.

### F. Latency-critical work must not wait on audit persistence

Sources 10, 12, 13, 17, 22, 23, 39, 41, 45, and 47 all point toward shortening the speech-to-response critical path. Database persistence is not required to determine the current legal answer and therefore should not delay it.

**Implementation:** conversation persistence is now asynchronous and fail-local. The HTTP response no longer waits for the failing lexara_conversations insert.

### G. Current supported AI models must replace stale IDs

Sources 11, 14, 16, 19, 26–38 support provider-specific model lifecycle management rather than hard-coding historical model IDs indefinitely.

**Implementation sequence and current defaults:**

- **Anthropic:** legal-live preferred path uses claude-sonnet-4-6; Haiku 4.5 remains a supported fast model.
- **Groq:** retired llama-3.3-70b-versatile is replaced by openai/gpt-oss-120b, with an environment override.
- **Mistral:** default is refreshed to mistral-small-2603, with environment override.
- **Gemini:** default is refreshed to gemini-3.8-flash; the configured Google key is allowed as a fallback credential source.
- **Cerebras:** stale Llama 3.1 defaults are replaced by current gpt-oss-120b.
- **SambaNova:** no retired model is silently assumed; the provider is enabled only when an explicit current SAMBANOVA_MODEL is configured.
- **ElevenLabs:** the existing configured LEXARA voice ID remains authoritative; TTS model defaults to eleven_flash_v2_5.

The live legal route intentionally uses the refreshed, bounded provider chain rather than passing into the older broad Geiger rotation after the legal chain fails. This prevents a second stale-model tree from multiplying latency and failure.

### H. The attorney-at-desk presentation must stay visible

The production asset /images/oip.webp was healthy; the mobile failure was layout behavior. The correct UI pattern for this experience is a stable visual region plus an independently scrollable transcript rather than page-level auto-scroll.

**Implementation:** the canonical mobile consultation uses a viewport-height grid. The OIP attorney-at-desk image remains in the upper visual region while only the transcript pane scrolls. The consent interstitial also uses the same established OIP attorney visual.

## Sequence used

1. Remove stale/invalid provider defaults and bound the legal model chain.
2. Remove database persistence from the critical response path.
3. Lock LEXARA to one TTS authority/voice and move to low-latency ElevenLabs Flash.
4. Keep recognition alive during playback and implement automatic barge-in.
5. Add echo suppression and duplicate-turn protection.
6. Replace page-level transcript auto-scroll with internal transcript scrolling so the attorney-at-desk visual remains visible.
7. Insert a mandatory book → consent/audio setup → consultation transition.
8. Remove camera coupling from live voice setup.
9. Honor the live-mode handoff explicitly at the consultation route.
10. Build, review, merge, then verify production behavior.

## Performance expectations

These changes remove two proven latency multipliers before tuning anything speculative: failed stale-provider rotation and synchronous database persistence. Flash TTS should reduce synthesis latency versus the prior multilingual model, while a single TTS authority removes accent-switch behavior. The largest remaining architectural performance upgrade, if later needed after production measurement, is true token-to-audio streaming (LLM streaming feeding ElevenLabs WebSocket/streaming TTS) rather than waiting for the complete legal response before beginning speech. That should be introduced only after the repaired provider path is measured so it does not obscure root-cause verification.

## Sources — exactly 50

1. W3C — Media Capture and Streams: https://www.w3.org/TR/mediacapture-streams/
2. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
3. MDN — SpeechRecognition.interimResults: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults
4. MDN — HTMLMediaElement.play(): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
5. MDN — SpeechRecognition.continuous: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous
6. Chrome Developers — Web Audio autoplay policy: https://developer.chrome.com/blog/web-audio-autoplay
7. MDN — MediaDevices.getUserMedia(): https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
8. MDN — MediaTrackConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
9. MDN — MediaTrackConstraints: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
10. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
11. Groq — Model deprecations: https://console.groq.com/docs/deprecations
12. ElevenLabs — Real-time TTS WebSockets: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
13. ElevenLabs — Stream text to speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
14. Google AI — Gemini models: https://ai.google.dev/gemini-api/docs/models
15. ElevenLabs — Reducing latency: https://elevenlabs.io/docs/api-reference/reducing-latency
16. Google AI — Gemini deprecations: https://ai.google.dev/gemini-api/docs/deprecations
17. ElevenLabs — Audio streaming concepts: https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming
18. ElevenLabs — Voice settings: https://elevenlabs.io/docs/speech-synthesis/voice-settings
19. Groq — Supported models: https://console.groq.com/docs/models
20. ElevenLabs — TTS vs dialogue WebSockets: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets
21. Groq — Speech to text: https://console.groq.com/docs/speech-to-text
22. ElevenLabs — Streaming TTS guide: https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming
23. ElevenLabs — TTS WebSocket API: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
24. ElevenLabs — Text-to-dialogue WebSocket API: https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket
25. ElevenLabs — Voice changer stream API: https://elevenlabs.io/docs/api-reference/speech-to-speech/stream
26. Anthropic — Claude documentation: https://docs.anthropic.com/en/docs/welcome?via=onetts.com
27. Anthropic — Claude documentation entry: https://docs.anthropic.com/en/docs/welcome?s=35
28. Anthropic — Model deprecations: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
29. Anthropic — Prompt templates and variables: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables
30. Mistral — Model comparison, Small 4: https://docs.mistral.ai/getting-started/models/compare?models=mistral-small-4-0-26-03
31. Cerebras — Supported models: https://inference-docs.cerebras.ai/models/overview
32. Mistral — Model comparison, Mistral Next: https://docs.mistral.ai/getting-started/models/compare?models=mistral-next
33. Mistral — Voxtral real-time transcription: https://docs.mistral.ai/getting-started/models/compare?models=voxtral-mini-transcribe-realtime-26-02
34. Mistral — Ministral model comparison: https://docs.mistral.ai/getting-started/models/compare?models=ministral-3-3b-25-12
35. Anthropic — Claude pricing/model context: https://docs.anthropic.com/en/docs/about-claude/pricing
36. Cerebras — Choosing a model: https://inference-docs.cerebras.ai/models/choose-a-model
37. Mistral — Model deployments: https://docs.mistral.ai/studio/workflows/getting-started/core_concepts/deployments
38. Mistral — Model playground: https://docs.mistral.ai/getting-started/quickstarts/studio/test-model-playground
39. AssemblyAI — Universal Streaming turn detection: https://www.assemblyai.com/docs/universal-streaming/turn-detection
40. AssemblyAI — Turn detection and interruptions: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions
41. AssemblyAI — Voice-agent streaming evaluations: https://www.assemblyai.com/docs/streaming/evaluations/voice-agents
42. AssemblyAI — Streaming message sequence: https://www.assemblyai.com/docs/streaming/message-sequence
43. AssemblyAI — Streaming webhooks: https://www.assemblyai.com/docs/streaming/webhooks
44. AssemblyAI — Universal Streaming with LiveKit: https://www.assemblyai.com/docs/speech-to-text/universal-streaming/livekit
45. AssemblyAI — Voice-agent best practices: https://www.assemblyai.com/docs/voice-agents/best-practices
46. AssemblyAI — Universal Streaming multilingual transcription: https://www.assemblyai.com/docs/universal-streaming/multilingual-transcription
47. AssemblyAI — Voice-agent turn detection: https://www.assemblyai.com/blog/voice-agent-turn-detection
48. AssemblyAI — Speech-to-speech voice agents: https://www.assemblyai.com/docs/voice-agents/speech-to-speech
49. AssemblyAI — Improving turn detection asynchronously: https://www.assemblyai.com/docs/streaming/guides/turn_detection_improvement_using_async
50. AssemblyAI — Programmatic streaming termination: https://www.assemblyai.com/docs/streaming/guides/terminate_realtime_programmatically
