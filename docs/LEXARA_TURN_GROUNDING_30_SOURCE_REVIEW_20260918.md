# LEXARA turn orchestration, grounding, and production repair — 2026-09-18

This review records the two required research passes used for the current LEXARA repairs.

## Resolution sources — exactly 20

1. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
2. MDN — SpeechRecognition continuous: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous
3. MDN — SpeechRecognitionResult isFinal: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal
4. MDN — SpeechRecognitionEvent resultIndex: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/resultIndex
5. MDN — SpeechRecognitionEvent results: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results
6. MDN — SpeechRecognition speechend: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/speechend_event
7. MDN — SpeechRecognition result event: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/result_event
8. MDN — MediaRecorder start(): https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start
9. MDN — MediaRecorder dataavailable: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event
10. MDN — MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
11. ElevenLabs — Realtime STT transcripts and commit strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
12. ElevenLabs — Realtime STT API: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
13. ElevenLabs — Client-side realtime STT: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
14. ElevenLabs — Server-side realtime STT: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/server-side-streaming
15. Groq — Speech to Text: https://console.groq.com/docs/speech-to-text
16. Groq — Whisper Large V3 Turbo: https://console.groq.com/docs/model/whisper-large-v3-turbo
17. Vite — Static Asset Handling: https://vite.dev/guide/assets
18. Vite — publicDir configuration: https://vite.dev/config/shared-options
19. OpenRouter — Model/provider routing and fallbacks: https://openrouter.ai/blog/insights/model-routing/
20. OpenRouter — Model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks

## Implementation sources — exactly 10

1. MDN — AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
2. MDN — AbortController.abort(): https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort
3. MDN — Using Fetch / cancellation: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
4. React — useRef: https://react.dev/reference/react/useRef
5. OpenRouter — Evaluating provider performance and latency routing: https://openrouter.ai/blog/insights/evaluate-llm-provider-performance/
6. OpenRouter — Web search via API: https://openrouter.ai/blog/announcements/introducing-web-search-via-the-api/
7. ElevenLabs — Streaming text to speech: https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming
8. Supabase — Connect to Postgres: https://supabase.com/docs/guides/database/connecting-to-postgres
9. Supabase — Connection pooling and limits: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits
10. PostgreSQL — SQLSTATE XX000 internal_error: https://www.postgresql.org/docs/18/errcodes-appendix.html

## Repo and production findings

- Browser SpeechRecognition final results are segments, not reliable full conversational-turn boundaries. The live client was committing them after 350 ms and server segments after 120 ms.
- The browser handler re-read changed result ranges without owning final result indexes, allowing overlap and duplication across final segments.
- Every prematurely committed fragment created another chat request and aborted the previous request, producing the observed HTTP 499 storm.
- Provider-level aborts/timeouts were entering global cooldowns, causing healthy fallback providers to be skipped on subsequent turns.
- LEXARA authority research was directly coupled to GoogleGenAI/Google Search grounding even though the platform already has crawler and AI-provider orchestration.
- The attorney image existed in repository root public/images, while Vite root is client and publicDir was implicit, so the image files were not copied to the production dist. Missing image requests were then hidden by SPA fallback.
- Conversation persistence is non-blocking, but production inserts return PostgreSQL XX000 and stateless master identity is not a durable users-table identity.

## Chosen implementation

- Treat final transcript segments as stable speech pieces, not immediate user turns. Accumulate them with overlap-aware merging and flush primarily on speech-end, with a longer safety fallback.
- Own browser final result indexes per recognition session so final results cannot be emitted twice.
- Never abort active reasoning merely because another recognition fragment arrives. Queue one merged pending user turn while analysis is active.
- Do not penalize providers globally for cancellation/timeout-shaped failures; keep genuine auth/rate-limit/server failures bounded and route-local.
- Replace the Google-specific authority path with PANTHEON/unified web retrieval and the existing AI-provider orchestration. Source material remains untrusted and only real URLs are admitted as grounding.
- Use OpenRouter online web search only as the crawler fallback so fallback search has actual current web evidence rather than model recollection.
- Make Vite copy the repository root public directory explicitly and make missing static assets return 404 instead of SPA HTML.
- Treat the stateless master identity as non-persistent for the lexara_conversations foreign key and add a bounded XX000 insert retry without RETURNING, while keeping persistence off the conversational critical path.
- Keep ElevenLabs as the sole LEXARA acoustic identity and the attorney-behind-desk image as the canonical visual.
