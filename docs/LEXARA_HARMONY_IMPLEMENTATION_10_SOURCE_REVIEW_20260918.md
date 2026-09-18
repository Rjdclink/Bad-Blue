# LEXARA — 10-Source Conversation/Latency Implementation Review (2026-09-18)

## Scope

This second pass validates implementation choices for immediate conversational feedback, duplex speech, end-of-turn latency, TTS time-to-first-audio, echo rejection, and interruption handling.

## Implementation conclusions applied

- Separate conversational acknowledgement from deep legal analysis so the first spoken reaction is not blocked by retrieval or multi-model reasoning.
- Start deeper analysis concurrently with the acknowledgement path.
- Treat time-to-first-audio, not only model inference time, as the user-visible latency metric.
- Keep Flash v2.5 for low-latency LEXARA voice and prefer streaming-compatible architecture.
- Reduce silence/settle windows while preserving a longer grace path for linguistically incomplete legal narratives.
- Keep recognition active during playback and reject speaker leakage before accepting it as a user turn.
- Use acoustic echo cancellation plus lexical echo/phantom-tail safeguards; neither is sufficient alone.
- Preserve interim recognition for interruption detection but commit only stable/final text to the legal conversation.
- Do not let visual “thinking” status substitute for an audible acknowledgement.

## Sources — exactly 10

1. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
2. ElevenLabs — Real-time TTS WebSocket: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
3. ElevenLabs — Understanding latency / time-to-first-audio: https://elevenlabs.io/docs/eleven-api/concepts/latency
4. Groq — Production latency and TTFT optimization: https://console.groq.com/docs/production-readiness/optimizing-latency
5. AssemblyAI — Voice-agent turn detection: https://www.assemblyai.com/blog/voice-agent-turn-detection
6. AssemblyAI — Universal Streaming turn detection: https://www.assemblyai.com/universal-streaming
7. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
8. MDN — SpeechRecognition.interimResults: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults
9. MDN — SpeechRecognition.continuous: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous
10. MDN — MediaTrackConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation

## Resolution sequence

1. Strip false closer tails before a finalized transcript enters conversation state.
2. Shorten endpointing/settle latency without shortening the longer incomplete-thought grace window below conversationally safe bounds.
3. Add a deterministic context-aware acknowledgement endpoint with no LLM or retrieval dependency.
4. Start acknowledgement speech while the deep Harmony/legal-research request continues.
5. Treat pure presence checks (“Are you still there?”) as conversational-control turns that bypass legal research.
6. Keep full-duplex recognition active with echo screening.
7. Make master consultations ephemeral and rotate session state on law-area changes/login transitions.
8. Preserve deep legal authority research and full Harmony for substantive answers.
