# Claude and Gemini production models (October 2026)

The canonical defaults live in `server/aiHarmonyModelRegistry.ts`. The LegalWhat inference policy currently admits **Claude only**; older documentation describing 17 active providers is obsolete.

| Workload | Default model | Access |
|---|---|---|
| Trial and other non-paid legal requests | `claude-haiku-5-5` | Fixed lowest-cost Claude model, low effort, no Sonnet/Opus escalation |
| Paid legal conversation | `claude-sonnet-5-5` | Paid/master entitlement only |
| Paid deep legal analysis and drafting | `claude-opus-5-5` | Server-approved paid/master entitlement only |
| Gemini text and discovery adapters (outside LegalWhat inference) | `gemini-3.8-flash` | Google credential/configuration |
| Gemini voice adapter (inactive under current Deepgram-only routing) | `gemini-3.8-flash-lite-tts` | Google credential; supports native WAV output without activating a new paid provider |

SDK versions are declared in `package.json` and locked in `package-lock.json`. Environment overrides remain supported where explicitly configured for non-trial work. Existing Claude token limits, prompt caching, request metering, retry bounds and paid-entitlement gates remain unchanged. Haiku 5.5 uses low effort to reduce trial consumption. Its newer tokenizer counts more tokens for identical text, while pricing is lower for prompts under 100,000 input tokens; the metering code handles the higher long-context rate.

Do not add additional models or retries to trial routing. This update adds no new test files and does not use paid inference for validation.
