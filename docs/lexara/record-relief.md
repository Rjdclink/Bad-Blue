# Lexara criminal record relief

Lexara now routes expungement questions and related sealing, set-aside, vacation, and criminal annulment requests through a case-specific intake, record retrieval, current-law comparison, and the existing downloadable-document workflow. This change is prepared for review; it does not merge or deploy production.

## Scope and legal research

`RecordReliefSources.ts` contains discovery leads and remedy-specific research priorities for all 50 states. It deliberately contains no static, binary eligibility verdicts or unsourced waiting-period calculator. The accompanying source audit records the actual direct-retrieval results, including outages and blocked sites. A reachable page is not a reviewed complete statute or a validated eligibility rule.

Research broadens from the state's official leads through Lexara's existing independent provider mesh and supplemental discovery. It retrieves current text, preserves relevant qualifications beyond the preamble, and keeps provenance and evidence level. Search and source retrieval have bounded budgets; provider failures retain usable official evidence. No alternate-query Claude classifier is purchased for this workflow. One fast reasoning call normally explains the gathered evidence; absent current official law text produces a deterministic unresolved response without an answer-model call.

The initial 50-state search found material changes that make historic eligibility tables unsafe: states distinguish expungement from sealing or set-aside, automatic relief differs from petition relief, implementation dates matter, and some pages or bills are outdated. All jurisdiction profiles therefore instruct live verification of the applicable route, offense class, exclusions, waiting-period trigger, and procedure. Proposed legislation and archived sources cannot establish a current entitlement. This is a retrieval-grounded workflow, not a claim that every state's rules or every county's forms have received attorney validation.

## User flow

1. Establish the originating case state and state/federal court system. Residence, device location and an old UI jurisdiction do not establish case origin. Multiple possible states require clarification.
2. Identify the person's case using an explicit name/caption or case number. Public searches use a minimal court-record objective; DOB, SSN, address, hardship narrative and the full conversation are excluded. Existing publicly available RECAP filings and official-source discovery are reused; no PACER purchases or new provider subscriptions are added.
3. Explain available charges, dispositions and sentence information. Name matches and docket metadata remain candidates. Confirm court, case number, parties and dates before attributing a case. A charge is not a conviction, and unavailable results are not a clean record.
4. Compare each count against retrieved current controlling requirements. Establish disposition, offense/class, age where relevant, dates and triggering event, sentence/probation/parole completion, monetary obligations, other convictions, pending charges and prior relief. Explain provisional availability, waiting-period barriers, exclusions or unresolved facts and cite the decisive authority. Eligibility to petition does not guarantee approval.
5. If a record, certificate or disposition is inaccessible, explain the gap and help obtain it from the clerk or authorized agency. Public web retrieval does not offer comprehensive access to all state criminal-history repositories, authenticated portals or sealed records.
6. For document preparation, independently compare supplied facts and same-case evidence to current official text. The gate rejects absent authority, missing indispensable facts, unsupported source URLs, ambiguity and incompatible forms. Ordinary earlier assistant answers do not establish law or case facts.
7. Select a current official form and instructions for the actual remedy and court. Relevant official text must have been retrieved. Required forms use the existing PDF/DOCX completion path; blank official forms remain available without a personal eligibility decision. A custom petition requires affirmative official support for optional/custom pleading. Failure to find a form does not authorize inventing one.
8. Generate persuasive drafts from supplied rehabilitation and hardship evidence, without fabricating remorse, employment, treatment, victim consent or judicial findings. Preserve necessary placeholders and sourced companion documents/service requirements. Existing validation, exports and saved-matter controls apply. No filing, signature, notarization, merge or deployment is performed automatically.

Court document candidates have a separate response/persistence field and an explicit unconfirmed-match label. The client carries that label into drafting and restores it with the user's own saved conversation. Existing account/subscription and owner-scoped persistence behavior remains in force. Model-suggested eligibility is provisional; this feature is not a substitute for complete source text and court review.

## GitHub references reviewed

These projects informed workflow patterns only. No code, statutory tables or dependencies were imported.

| Project | Snapshot inspected | Pattern used | Limitation |
| --- | --- | --- | --- |
| [civictechdc/clean-slate](https://github.com/civictechdc/clean-slate/tree/e9ebd5aa08773520bdfe4500be68bf55f84819f1) | `data/combined-flow.json`, README, MIT license | Guided intake with an explicit acquire-record endpoint and unresolved facts | Historic DC-specific rules; unsuitable as nationwide current law |
| [civictechdc/rfj_expungement](https://github.com/civictechdc/rfj_expungement/tree/1713304381c401f626802a67258c9fae5db64d19) | `libs/evaluator.js`, `libs/state-machines.js`, usage example, MIT license | Explicit unknown outcome and separate disposition-dependent eligibility routes | Historic DC analysis; missing implementations and date calculations must not be reused as current rules |
| [jhpyle/docassemble](https://github.com/jhpyle/docassemble) | Project documentation | Guided interviews and document assembly | Existing LegalWhat forms/export machinery suffices; not installed |
| [codeforamerica/rap-sheet-assistant](https://github.com/codeforamerica/rap-sheet-assistant) | Archived project documentation | Separate record extraction from interpretation | Requires external OCR infrastructure; no new credentials or integration added |

## Validation and remaining limits

- Scratch behavior fixtures passed for all 50 state origins/codes, residence versus case origin, federal cases, multiple states, West Virginia, topic changes and longer intake continuity, named document aliases, avoiding early document inference, metadata versus source text, research isolation, minimal public queries and the filing gate's missing-fact/source checks.
- Existing Lexara realization, six-sequence routing and crawler capability checks passed; the existing document-handoff fixture's import mock was updated for the new relief guard.
- Subscription gate, Vite client build and production server bundle passed. The client build retains existing large-chunk warnings.
- Repository-wide TypeScript checking remains blocked by pre-existing errors. Baseline comparison was performed in a detached checkout; four pre-existing invalid `kind` properties in the already-edited authority discovery function were removed because source classification is handled by its `add` function.
- Live authenticated record retrieval, model responses, form completion and Railway production behavior require validation in the deployed environment. These were not claimed as tested here. Direct access was blocked by some official sites or the environment proxy, or returned errors; runtime search fallback and unresolved answers are essential.
