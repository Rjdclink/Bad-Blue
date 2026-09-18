# LEXARA voice reliability and latency resolution review — 2026-09-18

This review records the ten authoritative sources used for the corrective implementation.

## Sources — exactly 10

1. MDN — HTMLMediaElement.play(): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
2. MDN — Autoplay guide for media and Web Audio APIs: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
3. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
4. MDN — MediaRecorder stop event: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop_event
5. MDN — Using the Fetch API / streaming response bodies: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
6. ElevenLabs — Client-side realtime speech-to-text streaming: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
7. ElevenLabs — Create transcript API: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
8. ElevenLabs — Realtime transcripts and commit strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
9. ElevenLabs — Streaming text-to-speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
10. Groq — Speech-to-text / Whisper Large V3 Turbo: https://console.groq.com/docs/speech-to-text

## Resolutions implemented

- Reuse one persistent HTMLAudioElement that is unlocked by the user's gesture and later owns all LEXARA playback.
- Treat play() success/failure as authoritative instead of assuming a temporary silent element unlocks future media elements.
- Preserve browser SpeechRecognition as the first path where supported; keep server STT as a route-local fallback.
- Reduce server VAD silence endpointing from 900 ms to 550 ms and remove the extra fixed 850 ms post-transcription delay in favor of engine-specific settling.
- Propagate STT acoustic-quality evidence (log probability and no-speech probability) to transcript admission.
- Prefer Groq Whisper Large V3 Turbo on the batch fallback for low latency and no-speech evidence; retain ElevenLabs Scribe as an independent fallback with word-level log-probability evidence.
- Reject generic hallucination-shaped transcripts only when acoustic evidence is weak, rather than blacklisting legitimate acknowledgements.
- Invalidate stale server transcription work when the recognition session is replaced or torn down.
- Keep ElevenLabs as the sole LEXARA acoustic identity and retain progressive streaming TTS.
- Verify the attorney-behind-desk image semantically rather than with a stale literal src assertion.
