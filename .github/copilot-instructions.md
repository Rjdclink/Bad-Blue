# CryptoCrawler Authorization Semantics

When working on CryptoCrawler startup, governance, StageManager, AutonomousFaucet, progression, or execution paths:

- Treat authorization as an automatic decision derived from the authoritative governance and stage-capability system: current stage, verified requirements and evidence, risk and safety constraints, capital, gas, validation, execution envelopes, and kill-switch state.
- Do not interpret authorization as human approval, human authorization, operator approval, manual approval, a manual stage advancement, an approval flag, or any equivalent human prerequisite for normal startup, operation, progression, or stage-authorized execution.
- Inspect every symbol or field named or semantically equivalent to `authorized`, `authorization`, `approved`, `approval`, `humanAuthorized`, `humanApproval`, `operatorApproval`, `manualApproval`, `requiresApproval`, `awaitingAuthorization`, `authorize()`, `requireAllowed()`, and `requiresHumanApproval` before changing it. Classify each use:
  - Preserve automatic governance and stage-capability authorization checks.
  - Remove or replace routine human-controlled prerequisites with the authoritative automatic decision.
- Preserve `requireAllowed()` and equivalent gates when they enforce automatic stage capability, verified evidence, risk, capital, gas, validation, envelope, or kill-switch requirements. If the current stage lacks a capability, authorization must remain denied.
- Automatic progression must remain requirements-based: legitimate evidence satisfies the next-stage requirements, StageManager advances automatically, and the reached stage's capabilities become authoritative. Never hardcode a stage, approval, successful validation, capital, balance, market data, connectivity, or progression evidence.
- Stage 1 must be active and observational while execution-constrained. It may collect and validate live information and evaluate progression, but it must not execute live trades merely to activate.
- Human controls may pause, stop, restrict, or engage emergency and kill-switch protections. They must not be required to grant routine autonomous permission. Do not weaken circuit breakers, risk limits, capital constraints, gas/funding checks, validation requirements, execution envelopes, or stage restrictions.
- After changing startup or activation, trace through the first scheduled market cycle and progression evaluation. Confirm the Start request, authoritative singleton, faucet active state, scheduler, TradingView, MultiOracle/RPC validation, market gates, and StageManager evaluation remain connected.
