# Lexara and Pantheon provider routing

Updated 2026-09-30.

## Legal questions and legal documents

Lexara's legal lane admits only Claude (Anthropic), Gemini (Google), and Grok (xAI's own API key and endpoint). Claude Sonnet owns normal legal turns. Gemini and xAI Grok are scarce support capacity: at most one joins when the real user task materially needs independent verification, multimodal help, or deep/document reasoning. If Claude fails, one healthy support provider may carry the user task. A provider already known quota-blocked, cooling, misconfigured, or catalog-degraded is excluded before dispatch and cannot turn its known failure into user-facing latency.

Startup is catalog-only. LegalWhat may inspect configured keys and provider model catalogs, but it must not send synthetic Claude, Gemini, or xAI inference prompts. Gemini is also excluded from Lexara's ordinary parallel search fan-out; normal retrieval lanes run first, and scarce model inference is reserved for user-answer support.

The legal model IDs are `claude-sonnet-5-5`, `gemini-3.8-flash`, and `grok-4.7` (with `grok-4.6` after a model-specific permission denial). Shared quota admission, observed provider feedback, and Retry-After handling prevent avoidable bursts. Gemini daily exhaustion is persisted until its Pacific-time daily reset, and rate/quota errors are surfaced immediately rather than retried into additional scarce calls.

## Background searches

Pantheon runs its independent search lanes first. On a miss, Jenova's accessible Professional Background Investigator agent and Groq's `qwen/qwen3.8-27b` suggest alternate searches in parallel. Groq can try `openai/gpt-oss-20b` if the project's preferred model is denied. If neither assistant gives a useful suggestion, Claude Sonnet may suggest alternate searches as a fallback. Suggestions are run through the search engines; they are never treated as verified facts. Busy or failed assistants cannot block the original search result. Search URLs then go to optional source retrieval and crawlers for enrichment. The source evidence and identity checks remain the authority for factual claims.

Jenova uses `JENOVA_API_KEY` and discovers its accessible agent with `GET /agents`; `JENOVA_BACKGROUND_AGENT` may override the slug. Groq uses `GROQ_API_KEY`. Lexara's direct Grok uses the separate `XAI_API_KEY`. Pantheon assistant calls run only when search misses, with bounded simultaneous requests rather than a total usage cap.
