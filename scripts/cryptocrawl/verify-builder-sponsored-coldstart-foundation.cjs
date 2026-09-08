const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const adapter = read('server/services/cryptocrawl/execution/adapters/builder-sponsored-bundle.ts');
const gasProof = read('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts');
const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('Titan public bundle endpoint is explicit', adapter.includes("endpoint: 'https://rpc.titanbuilder.xyz'"));
check('Quasar public bundle endpoint is explicit', adapter.includes("endpoint: 'https://rpc.quasar.win'"));
check('Titan documented coinbase is explicit', adapter.includes("coinbaseAddress: '0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97'"));
check('Quasar documented coinbase is explicit', adapter.includes("coinbaseAddress: '0x396343362be2A4dA1cE0C1C210945346fb82Aa49'"));
check('transport needs no new API-key variable', !/TITAN_API_KEY|QUASAR_API_KEY/.test(adapter));
check('Ethereum mainnet is the only admitted sponsored-builder chain', adapter.includes('parsed.chainId !== 1') && adapter.includes('network.chainId !== 1'));
check('builder payment is parsed from the actual signed transaction', adapter.includes('ethers.utils.parseTransaction(serialized)') && adapter.includes('builderPaymentWei: payment.value'));
check('terminal signed transaction must target builder coinbase', adapter.includes('Terminal signed transaction must pay the documented'));
check('terminal builder payment must come from expected controlled signer', adapter.includes('payment.from.toLowerCase() !== expectedSender.toLowerCase()'));
check('caller cannot inject the stale synthetic guaranteedBuilderPaymentWei claim', !adapter.includes('guaranteedBuilderPaymentWei'));
check('builder payment provenance is execution-created value', adapter.includes("source: 'execution_created_value'") && adapter.includes("paymentProvenance: 'execution_created_value'"));
check('canonical residual profit must stay positive', adapter.includes('guaranteedResidualProfitUsd <= 0') && adapter.includes('candidate.guaranteedResidualProfitUsd > 0'));
check('signed payment covers sponsorship plus builder residual', adapter.includes('proof.builderPaymentWei < required + builderResidual') && adapter.includes('candidate.builderPaymentWei < candidate.requiredSponsorshipWei + candidate.minimumBuilderResidualWei'));
check('submission uses standard eth_sendBundle', adapter.includes("method: 'eth_sendBundle'"));
check('partial inclusion is quarantinable ambiguity', adapter.includes("Only part of the sponsored bundle was observed on chain") && adapter.includes("status: 'ambiguous'"));
check('accepted bundle without a valid hash remains ambiguous', adapter.includes('accepted request without a valid bundle hash') && adapter.includes("this.result(attempt, 'ambiguous'"));
check('accepted bundle transport uncertainty remains ambiguous', adapter.includes("lastBundleHash ? 'ambiguous' : 'definitive_failure'"));
check('only a fully mined target-block miss is retry-safe', adapter.includes("included.length > 0") && adapter.includes("Target block mined without the sponsored bundle landing") && adapter.includes("return { status: 'definitive_failure', blockNumber"));
check('bounded block retargeting is explicitly capped', adapter.includes('ZERO_CAPITAL_BUILDER_BLOCK_WINDOW') && adapter.includes('Math.max(1, Math.min(5, Math.trunc(raw)))') && adapter.includes('targetBlock <= candidate.maxTargetBlock'));
check('ambiguous reconciliation stops block-window advancement', adapter.includes("if (landed.status === 'ambiguous')") && adapter.includes("return this.result(attempt, 'ambiguous'"));
check('same signed bundle is reused across bounded targets', adapter.includes('txs: attempt.signedTransactions') && !adapter.includes('signTransaction('));
check('terminal builder payment receipt is reconciled in target block', adapter.includes('paymentReceipt.blockNumber !== candidate.targetBlock'));
check('adapter explicitly owns no independent execution authority', adapter.includes('executionAuthority: false') && !adapter.includes('getZeroInitialCapitalDynamicOrchestrator'));
check('existing strict gas proof still refuses to promote hosted sponsor billing', gasProof.includes('sponsorOperatorMonetaryCostProvenZero: false'));
check('universal coverage already recognizes builder sponsorship as a route, not a bypass', coverage.includes('builder-sponsored bundles') && coverage.includes('personalGasAllowed: false'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`builder-sponsored-coldstart-foundation verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[builder-sponsored-coldstart-foundation] Titan/Quasar keyless sponsored-bundle transport is bound to signed builder payment, fresh positive canonical residual economics, bounded exact-target-block retry after fully reconciled misses only, ambiguous-submission quarantine, and the existing zero-personal-cost authority; operator-billed hosted sponsorship remains unproven');