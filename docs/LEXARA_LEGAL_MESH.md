# Lexara and Pantheon provider routing

Updated 2026-09-28.

## Legal questions and legal documents

Lexara's legal lane admits only Claude (Anthropic), Gemini (Google), and Grok (xAI's own API key and endpoint). Claude Sonnet is the first choice and the preferred final synthesizer; Gemini and xAI Grok assist from independent accounts. A short conversation can use a delayed hedge; deeper reasoning and drafting use independent specialists in parallel and preserve any successful draft if synthesis fails. Failed attempts can move to the other eligible providers while a provider's actual quota or cooldown is respected. The Groq hosting service and OpenRouter's GROK alias are outside this legal lane. The platform's wider Harmony pool remains available to unrelated services.

The legal model IDs are `claude-sonnet-5`, `gemini-3.8-flash`, and `grok-4.7` (with `grok-4.6` after a model-specific permission denial). Shared quota leases, observed rate-limit headers, and Retry-After feedback prevent avoidable bursts. There is no arbitrary daily or monthly usage cap. Internal deadlines preserve a recovery window for legal-document synthesis. External provider outages and limits can still prevent an answer.

## Background searches

Pantheon runs its independent search lanes first. On a miss, Jenova's accessible Professional Background Investigator agent and Groq's `qwen/qwen3.8-27b` suggest alternate searches in parallel. Groq can try `openai/gpt-oss-20b` if the project's preferred model is denied. If neither assistant gives a useful suggestion, Claude Sonnet may suggest alternate searches as a fallback. Suggestions are run through the search engines; they are never treated as verified facts. Busy or failed assistants cannot block the original search result. Search URLs then go to optional source retrieval and crawlers for enrichment. The source evidence and identity checks remain the authority for factual claims.

Jenova uses `JENOVA_API_KEY` and discovers its accessible agent with `GET /agents`; `JENOVA_BACKGROUND_AGENT` may override the slug. Groq uses `GROQ_API_KEY`. Lexara's direct Grok uses the separate `XAI_API_KEY`. Pantheon assistant calls run only when search misses, with bounded simultaneous requests rather than a total usage cap.
