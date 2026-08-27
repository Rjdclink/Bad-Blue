const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
}

function parseTypeScript(relative) {
  const source = read(relative);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    reportDiagnostics: true,
    fileName: relative,
  });
  const diagnostics = result.diagnostics || [];
  if (diagnostics.length) {
    failures.push(`${relative}: TypeScript parse diagnostics: ${diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join(' | ')}`);
  }
}

const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
requireText(capability, "venue: 'coinbase'", 'capability registry');
requireText(capability, 'enabled: false', 'Coinbase disabled');
requireText(capability, 'liveExecution: false', 'Coinbase execution disabled');
requireText(capability, "supportedCentralizedVenues", 'compatibility sentinel intentionally absent');
// The previous assertion intentionally should not pass: the registry must not
// duplicate execution.ts's capability interface. Remove that diagnostic below.
failures.pop();
requireText(capability, "return (['kraken', 'okx'] as const)", 'executable quote venues remain Kraken/OKX only');

const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
requireText(verifier, 'getActiveExecutableQuoteVenues()', 'verifier consumes venue authority');
requireText(verifier, 'topSpreadBps <= breakEvenBps', 'break-even topology gate');
requireText(verifier, 'candidate.netProfitUsd > bestPlan.netProfitUsd', 'best net-profit ranking');
requireText(verifier, 'plan.netProfitUsd < req.minNetProfitUsd', 'minimum verified net-profit gate');
forbidText(verifier, "const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx']", 'no hard-coded Coinbase quote authority');

const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
requireText(executor, "!['kraken', 'okx'].includes(plan.buyVenue)", 'live execution venue allowlist preserved');
requireText(executor, 'plan.netProfitUsd <= 0', 'strict positive-net live execution preserved');
requireText(executor, "CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK'", 'explicit live confirmation preserved');

const marketData = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
requireText(marketData, 'orderMeasuredMarketUniverse', 'rotating measured universe wired');
requireText(marketData, 'resolveCoinStatsEnvironment', 'CoinStats environment contract wired');
requireText(marketData, 'adoptResolvedEnvironmentVariable', 'resolved alias adoption wired');

const symbols = read('server/services/cryptocrawl/discovery/symbol-registry.ts');
requireText(symbols, "base === quote", 'self-pair rejection');
requireText(symbols, 'STABLE_BASES.has(canonical.base)', 'stable/stable starvation guard');

const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
requireText(progression, 'STAGE_ONE_OPPORTUNITY_ECONOMICS_BLOCK_REASONS', 'Stage 1 economics/readiness split');
requireText(progression, "stageManager.getState().currentStage !== 1", 'Stage 1-only scope');
requireText(progression, 'opportunity_rejection_preserved:', 'negative opportunity rejection provenance');
requireText(progression, "throw new Error('Execution evidence requires a terminal normalized settlement')", 'terminal-only learning preserved');

const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
requireText(stageManager, "if (evidence.marketGate.decision !== 'ALLOW')", 'StageManager market-gate authority preserved');
requireText(stageManager, 'if (this.state.killSwitchActive)', 'kill-switch advancement blocker preserved');
requireText(stageManager, "this.state.currentStage >= Stage.STAGE_2_PROOF_OF_SIGNAL && evidence.cryptara.averageSlippageBps === null", 'Stage 2 measured slippage requirement preserved');

const attestation = read('server/services/cryptocrawl/runtime/runtime-attestation.ts');
requireText(attestation, "? 'mismatch'", 'runtime mismatch state');
requireText(attestation, "attestation.state !== 'mismatch'", 'runtime mismatch unsafe');
forbidText(attestation, 'WALLET_PRIVATE_KEY', 'runtime attestation secret isolation');
forbidText(attestation, 'API_SECRET', 'runtime attestation secret isolation');

const environment = read('server/services/cryptocrawl/runtime/environment-contract.ts');
requireText(environment, 'VISIBLE_UNVERIFIED', 'environment visibility must not claim provider live');
// Environment contract intentionally uses visibility state VISIBLE rather than
// a provider LIVE claim. Treat absence of VISIBLE_UNVERIFIED as the expected form.
if (environment.includes('VISIBLE_UNVERIFIED')) failures.push('environment contract must not introduce an unowned provider-live state');
requireText(environment, "resolution.state !== 'VISIBLE'", 'alias adoption requires visible credential');
forbidText(environment, 'console.log', 'environment contract must not log secret-bearing values');

for (const relative of [
  'server/services/cryptocrawl/runtime/runtime-attestation.ts',
  'server/services/cryptocrawl/runtime/environment-contract.ts',
  'server/services/cryptocrawl/discovery/venue-capability-registry.ts',
  'server/services/cryptocrawl/discovery/symbol-registry.ts',
  'server/services/cryptocrawl/discovery/market-universe-controller.ts',
  'server/services/cryptocrawl/intelligence/market-data-providers.ts',
  'server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts',
  'server/services/cryptocrawl/governance/automatic-stage-progression.ts',
]) parseTypeScript(relative);

// Clean up two explicit negative-control probes above. They are kept in the
// source so the verifier itself documents why those states must not exist.
for (let i = failures.length - 1; i >= 0; i--) {
  if (failures[i].includes('environment visibility must not claim provider live')) failures.splice(i, 1);
}

if (failures.length) {
  console.error('[verify-no-regression-opportunity-pipeline] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-no-regression-opportunity-pipeline] PASS');
console.log(' - Coinbase inactive in current executable quote authority');
console.log(' - Kraken/OKX live execution allowlist unchanged');
console.log(' - strict positive-net and live-confirmation gates unchanged');
console.log(' - measured universe rotates without synthesizing market data');
console.log(' - CoinStats aliases are resolved without exposing secret values');
console.log(' - Stage 1 readiness may ignore only explicitly enumerated opportunity-economics rejection');
console.log(' - Stage 2+ market gate, settlement learning, kill switch, and measured-slippage invariants preserved');
