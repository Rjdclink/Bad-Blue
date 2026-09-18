# LEXARA Harmony, voice, and production integration review — 2026-09-18

## Sources — exactly 10

1. OpenRouter — Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
2. OpenRouter — Model and Provider Routing: https://openrouter.ai/blog/insights/model-routing/
3. OpenRouter — Web Search via the API: https://openrouter.ai/blog/announcements/introducing-web-search-via-the-api/
4. Anthropic — Model and API Parameter Deprecations: https://docs.anthropic.com/en/docs/about-claude/model-deprecations
5. Groq — Supported Models and Models API: https://console.groq.com/docs/models
6. ElevenLabs — Latency Optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
7. ElevenLabs — Streaming Text to Speech: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
8. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
9. Express — Middleware Ordering: https://expressjs.com/en/4x/guide/writing-middleware/
10. Express — Serving Static Files: https://expressjs.com/en/starter/static-files/

## Implementation sequence

- Use the platform Harmony collaboration engine as LEXARA's canonical live reasoning authority.
- Select analyst, verifier, and synthesizer roles by task capability/skill; do not maintain a permanent model winner.
- Exclude Google/Gemini from LEXARA's provider policy while preserving independent Claude, Groq, Mistral, DeepSeek, Grok, Kimi, and Qwen paths.
- Run analyst and verifier independently, then synthesize successful contributions; if a selected route fails, race compatible alternatives locally instead of failing the consultation.
- Discover the active Groq catalog before dispatch and substitute only an available capability-compatible model when a configured model is inaccessible.
- Normalize provider-specific parameters so newer Claude models are not sent deprecated sampling controls.
- Separate natural-language legal-source discovery from URL-only crawling. Use Firecrawl search first and a non-Google OpenRouter web-search fallback, admitting only real URLs as authority evidence.
- Keep static image requests out of the SPA fallback so the production static middleware can return the attorney WEBP bytes rather than index.html.
- Do not allow interim browser SpeechRecognition hypotheses to interrupt LEXARA. Barge-in requires final, echo-screened speech evidence.
- Keep ElevenLabs Flash streaming, reduce the live MP3 bitrate to lower mobile buffer pressure, and instrument playing/waiting/stalled events for production diagnosis.
