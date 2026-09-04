const fs = require('fs');
const path = 'server/services/cryptocrawl/optimization/external-capital-capability-registry.ts';
const text = fs.readFileSync(path, 'utf8');
function must(needle, message) { if (!text.includes(needle)) throw new Error(`${message} (${path})`); }
function mustNot(needle, message) { if (text.includes(needle)) throw new Error(`${message} (${path})`); }

must("id: 'jupiter-lend-flashloan:solana'", 'Jupiter Lend atomic-principal capability missing');
must('bootstrapEligible: true', 'At least one proven atomic-principal bootstrap capability must be represented');
must("id: 'morpho-midnight-lend:base'", 'Morpho Midnight fixed lending capability missing');
must("id: 'morpho-midnight-borrow:base'", 'Morpho Midnight fixed borrowing capability missing');
must("role: 'fixed_lend'", 'Morpho lending must not be conflated with collateralized borrowing');
must('lender_credit_units_not_borrower_collateral', 'Morpho lender role must explicitly avoid borrower-collateral semantics');
must('accepted_collateral_and_health_required', 'Morpho borrower role must preserve collateral/health requirements');
must("id: 'compound:evm'", 'Compound capability missing');
must("id: 'curve-llamalend-v2:evm'", 'LlamaLend v2 capability missing');
must("id: 'jupiter-offerbook:solana'", 'Jupiter Offerbook capability missing');
must("['auto-finance:multichain', 'auto_finance']", 'Auto Finance capability missing');
must("['ipor-fusion:evm', 'ipor_fusion']", 'IPOR Fusion capability missing');
must("['yo-protocol:multichain', 'yo_protocol']", 'YO Protocol capability missing');
must('requiresSystemOwnedCapital: true', 'Post-profit capital destinations must require system-owned capital');
must('executionAuthority: false', 'External capability registry must not execute');
must('capitalMovementAuthority: false', 'External capability registry must not move capital');
must('if (!capability.executionReady) return 0;', 'Unproven capability must have zero economic routing score');
must("capability.role === 'yield_destination' || capability.role === 'fixed_lend'", 'Executable retained-capital destinations must require measured yield/capacity/exit evidence');
must('availableLiquidityUsd', 'Executable retained-capital destinations must require measured capacity');
must('withdrawalLatencyMs', 'Executable retained-capital destinations must require measured exit latency');
must('native_fee_payer_proof_still_required', 'Zero-fee Jupiter principal must not imply zero operator transaction fee');
mustNot('Math.random', 'Capital capability ranking must never be randomized');

console.log('external capital capabilities: structural checks passed');
