# Lexara: verify law before answering

## Evidence and scope

Reviewed 2026-10-13. Base: `842a4f383104b94fba0aa62b4c3befbc62adbda3` (`develop`). Railway: adaptable-youth / production / Bad-Blue.

Recent logs show legal turns at 13:12:32 UTC and 13:13:15 UTC marked grounded with only `courtlistener` and `govinfo` lanes; a turn at 13:13:57 UTC selected conversation-only with zero sources. These logs do not contain the full user/assistant transcript, so they establish route behavior, not which exact sentence the user heard. Static inspection identifies a 10-second outer research race, snippet-based early completion, and a semantic classifier that explicitly excludes pure legal research. The latest failed build stops in an unrelated CryptoCrawler gas-spend verification script. No deployment or merge is part of this change.

## Source blueprint

Read the implementation as well as discovery results. These are design references, not code to copy or a claim of exhaustive internet coverage.

1. https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py — research completion precedes final-report generation; explicit iteration termination. Archived implementation used as an architectural example.
2. https://github.com/langchain-ai/langgraph/blob/main/examples/rag/langgraph_adaptive_rag.ipynb — grade retrieved documents, reformulate insufficient queries, evaluate grounded answers. Archived example checked against current documentation.
3. https://docs.langchain.com/oss/python/langgraph/agentic-rag — current retrieval / relevance / rewrite / generation workflow.
4. https://www.anthropic.com/engineering/building-effective-agents — explicit workflow gates and bounded evaluator/refinement loops; use simple composable implementation.
5. https://www.legis.iowa.gov/law/iowacode — current and historical Iowa Code discovery.
6. https://www.legis.iowa.gov/law/officialAndUnofficialEditions — official publication designations; publication date differs from effective date.
7. https://www.legis.iowa.gov/law/statutory/acts/actsChapter — enacted amendments and effective-date exceptions beyond an annual Code edition.
8. https://www.legis.iowa.gov/law/statutory/tablesAndIndexes — amended/repealed/transferred Code provisions and Acts-to-Code mappings.
9. https://www.legis.iowa.gov/law/courtRules — procedural authority when the issue requires it.
10. https://www.legis.iowa.gov/law/administrativeRules — administrative authority, current and archived editions.
11. https://wiki.free.law/c/courtlistener/help/api/rest/v4/search — search results are discovery material; read the actual applicable opinion.
12. https://www.govinfo.gov/features/api — federal publication discovery is not itself proof of a state-law proposition.
13. https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal — propagate cancellation and remove listeners after completion.
14. https://nodejs.org/api/timers.html — clear deadline timers when the operation settles.

## Before/after edit checklist

- Recognize implicit legal questions and contextual follow-ups; preserve greetings, intake and true conversation controls.
- Research controlling authority before final response or speech. Never equate a URL, publication date, result count or government domain with a verified legal proposition.
- Read source text, assess relevance to the question/jurisdiction/effective date, broaden queries when insufficient, and retain provenance.
- Bounded research must finish with supported evidence or an honest completed-attempt limitation. Cancellation and timeouts must clean up work and never trigger an unsupported legal answer.
- Preserve existing personal-record routes; this change concerns public legal authority only.
- Test actual async ordering, delayed retrieval, missing/irrelevant evidence, contextual routing, cancellations and source qualification. Keep changes on a review branch.

## Validation

Implemented contextual legal routing, primary-document retrieval, and a research completion gate before conversational legal generation. The gate checks source relevance, jurisdiction, effective dates and qualifications; it broadens up to three search passes within a 90-second deadline. It rejects unsupported source references, snippets, metadata-only results and failed assessments. This is bounded research, not an exhaustive scan of all law. The relevance assessment remains model-based and is not a guarantee of legal correctness.

Before/after review: routing changes checked against the research-brief/context patterns in references 1–4; source changes checked against references 5–12; waiting, cancellation and cleanup checked against references 13–14. The existing source network restrictions were preserved. No external repository code was copied.

Passed:
- `node scripts/test-lexara-verify-before-answer.cjs` — 10 behavioral groups, including real conversation orchestration with delayed research, correction queries, source-only gating, malformed assessments, invented URLs, cancellation, timeout, conversation controls, deterministic context fallback and real authority discovery with mocked transports.
- `node scripts/test-lexara-semantic-intent.cjs`.
- `node scripts/test-lexara-native-factual-routing.cjs`.
- esbuild bundle of `server/lexara/LexaraConversationOrchestrator.ts` with external packages; `git diff --check`.

Validation limitations:
- All model/transport regression responses are synthetic fixtures, not live legal acceptance.
- Full repository `tsc --noEmit` exhausted the available default Node heap (approximately 2 GB); no full type-check pass is claimed.
- `test-lexara-procedural-intent.cjs` fails with `require is not defined`; `test-lexara-research-routing.cjs` fails with `takeUnseenSpectraQueries is not defined`. Both failures were reproduced on an untouched worktree at the base commit.
- Local runtime is Node 24; production declares Node 20. Dependency installation used `npm ci --ignore-scripts --legacy-peer-deps`; the lockfile was not modified.

Production deployment blocker: Railway deployment `bd7468b8-e5d8-43b4-99cc-920293f281ba` fails in `scripts/cryptocrawl/verify-system-native-gas-spend-authority.cjs` with “Canonical discovery must derive funding eligibility from current durable proof.” The latest successful deployment found is `880b7a7a-44d4-4346-bff8-ea257ac07b0f`, commit `a0742ad4f5a8e7b0d5f31bb95ea90da211a06a94`. This unrelated build check was not bypassed or modified.

No merge or deployment has been performed. Live acceptance still requires a successful deployment and replay of the actual affected conversation; the retrieved logs do not expose its complete transcript.
