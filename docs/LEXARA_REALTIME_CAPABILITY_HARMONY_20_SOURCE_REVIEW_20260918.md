# LEXARA Real-Time Conversation + Capability Harmony Review (2026-09-18)

## Production/root-cause findings

The screenshots and live production logs show four interacting regressions: (1) speech arriving during an active legal-analysis request was appended to the prior user bubble instead of becoming a new turn; (2) the completed answer was discarded whenever a pending turn existed, which could leave the UI in a repeating analysis loop; (3) the Harmony refactor treated the 17-model pool as a fan-out mandate, waiting on unnecessary providers and retries; and (4) STT/TTS leakage and hallucinated courtesy phrases were only stripped at the transcript tail, so repeated “thank you / okay / goodbye” fragments could survive in the middle of a user turn.

The production logs also show route-local provider failures during the affected turns, including Mistral 429 rate limits, Groq reporting no permitted capability-compatible model, and Claude returning no text content block. The correct response is not to wait for every provider or fan retries outward; unhealthy routes should cool locally while the task uses the smallest capability-matched healthy subset.

## Root-cause/resolution sources — exactly 10

1. MDN — MediaTrackConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
2. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
3. AssemblyAI — Intelligent turn detection / endpointing: https://www.assemblyai.com/blog/turn-detection-endpointing-voice-agent
4. Anthropic — Building Effective AI Agents: https://www.anthropic.com/engineering/building-effective-agents
5. Microsoft AutoGen — Selector Group Chat: https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/selector-group-chat.html
6. Google SRE — Production Services Best Practices: https://sre.google/sre-book/service-best-practices/
7. Google SRE — Handling Overload: https://sre.google/sre-book/handling-overload/
8. Google SRE — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
9. Microsoft Azure Architecture Center — Bulkhead pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead
10. Microsoft Azure Architecture Center — Cloud design patterns / Circuit Breaker: https://learn.microsoft.com/en-us/azure/architecture/patterns/

## Resolutions

- Treat all 17 configured models as a capability pool, not as 17 mandatory respondents.
- Select the smallest healthy subset that covers the task’s required skills; ordinary live legal turns use two specialist contributors plus one synthesis pass.
- Keep provider failure route-local with cooldowns and one bounded alternate, rather than retry fan-out.
- Give each live provider call a short deadline and cap live legal generation size.
- Keep conversational control turns independent of the legal-analysis job. “Hello, are you still there?” must be a new turn and must not mutate the prior user statement.
- Never discard a completed answer merely because a later turn arrived.
- Use a soft-timeout acknowledgement only when the substantive answer is not already ready.
- Strip repeated generic STT artifacts wherever they occur in a transcript, not only at the tail.
- Prefer concise direct spoken answers: answer the current question in the first sentence and default to 2–5 sentences.

## Implementation sources — exactly 10

1. Deepgram — Endpointing: https://developers.deepgram.com/docs/endpointing
2. ElevenLabs — Conversation flow, soft timeouts, interruptions, turn eagerness: https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
3. Deepgram — Utterance End: https://developers.deepgram.com/docs/utterance-end
4. Deepgram — Force End Turn: https://developers.deepgram.com/docs/voice-agent-force-end-turn
5. Microsoft AutoGen — Candidate filtering in Selector Group Chat: https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/selector-group-chat.html
6. Deepgram — Configure Endpointing and Interim Results: https://developers.deepgram.com/docs/understand-endpointing-interim-results
7. ElevenLabs — Tool interruptions: https://elevenlabs.io/docs/eleven-agents/customization/tools/tool-configuration/tool-interruptions
8. Deepgram — Inject Agent Message (queue vs interrupt): https://developers.deepgram.com/docs/voice-agent-inject-agent-message
9. Deepgram — Flux TTS interruption handling: https://developers.deepgram.com/docs/flux-tts/interrupt-handling
10. Deepgram — Voice Agent Integration Patterns: https://developers.deepgram.com/docs/flux-tts/voice-agent

## Implementation sequence

1. Replace all-provider fan-out with capability subset selection and diversity-aware coverage.
2. Bound route-local failures with cooldowns, a single alternate, and live-call deadlines.
3. Make LEXARA legal synthesis concise and direct.
4. Separate presence/check-in turns from in-flight legal analysis.
5. Keep later substantive turns distinct in the transcript and queue them for follow-up analysis without rewriting the prior user bubble.
6. Add soft-timeout acknowledgements plus acknowledgement cooldown/deduplication.
7. Expand STT artifact filtering to repeated courtesy/farewell fragments anywhere in the utterance.
8. Shorten authority-research latency and retain fail-open legal conversation behavior.
9. Add build-time regression assertions for all of the above.
