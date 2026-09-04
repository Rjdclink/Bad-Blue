const fs = require('fs');
const path = 'server/services/cryptocrawl/optimization/external-capital-capability-registry.ts';
const text = fs.readFileSync(path, 'utf8');
function must(needle, message) { if (!text.includes(needle)) throw new Error(`${message} (${path})`); }
function mustNot(needle, message) { if (text.includes(needle)) throw new Error(`${message} (${path})`); }

must("id: 'jupiter-lend-flashloan:solana'", 'Jupiter Lend atomic-principal capability missing');
must('bootstrapEligible: true', 'At least one proven atomic-principal bootstrap capability must be represented');
must("id: 'morpho-midnight:base'", 'Morpho Midnight capability missing');
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
mustNot('Math.random', 'Capital capability ranking must never be randomized');

console.log('external capital capabilities: structural checks passed');
