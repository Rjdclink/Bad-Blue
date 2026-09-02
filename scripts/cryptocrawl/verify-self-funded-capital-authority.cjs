const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const hierarchy = read('server/services/cryptocrawl/core/capital-hierarchy.ts');
const hierarchyTest = read('server/services/cryptocrawl/testing/verify-capital-hierarchy.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const provenance = read('server/services/cryptocrawl/execution/adapters/stage4-capital-provenance.ts');
const allocation = read('server/services/cryptocrawl/execution/system-capital-allocation-ledger.ts');
const allocationMigration = read('server/migrations/026_cryptocrawler_system_capital_allocations.sql');
const overflowSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const dockerfile = read('Dockerfile');

assert.match(hierarchy, /CapitalSource\s*=\s*'self-funded'/, 'capital hierarchy must expose self-funded authority');
assert.doesNotMatch(hierarchy, /CapitalSource\s*=\s*[^;]*'wallet'/, 'raw wallet capital must not be an execution authority');
assert.match(hierarchy, /walletSufficient\s*&&\s*alternatives\.selfFundedEligible\s*===\s*true/, 'wallet location requires durable self-funded provenance');
assert.match(hierarchy, /external\/operator capital remains protected/, 'unproven external capital must be explicitly protected');
assert.match(hierarchyTest, /funded-wallet-without-provenance/, 'regression test must cover a funded external wallet');
assert.match(hierarchyTest, /verified-self-funded-capital/, 'regression test must cover verified self-funded capital');
assert.match(inventory, /if\s*\(venue\s*===\s*'coinbase'\)\s*return\s+Math\.max\(configuredMinimumReserve,\s*available\)/, 'Coinbase operator balance must remain non-spendable');
assert.match(inventory, /SYSTEM_CAPITAL_ALLOCATION_TABLE\s*=\s*'cryptocrawler_system_capital_allocations'/, 'CEX reservation must consume the canonical system-capital allocation table');
assert.match(inventory, /status='PLACED'/, 'only settlement-confirmed placed capital may establish CEX ownership');
assert.match(inventory, /const physicalSpendable =/, 'CEX admission must retain authenticated physical-balance capacity');
assert.match(inventory, /const systemOwnedSpendable =/, 'CEX admission must calculate provenance-backed spendable ownership');
assert.match(inventory, /Math\.min\(physicalSpendable, systemOwnedSpendable\)/, 'CEX reservation must be capped by both physical and system-owned capacity');
assert.match(inventory, /!isDatabaseConfigured \|\| !await this\.ensureTables\(\)/, 'live CEX reservation must fail closed without durable Overflow state');
assert.match(inventory, /operatorBalanceAuthorityGranted:\s*false/, 'reservation rejection telemetry must explicitly deny operator-balance authority');

assert.match(provenance, /recordVerifiedRetainedProfit/, 'verified retained profit must accumulate in canonical SELF_FUNDED provenance');
assert.match(provenance, /SELECT \* FROM zero_capital_capital_state WHERE scope = \$1 FOR UPDATE/, 'capital provenance mutation must lock its canonical source row');
assert.match(allocation, /strategySelectionAuthority:\s*'cryptara'/, 'allocation must preserve Cryptara strategy authority');
assert.match(allocation, /notionalAuthority:\s*'profit_ladder'/, 'allocation must preserve Profit Ladder notional authority');
assert.match(allocation, /executionAuthority:\s*'stage_manager'/, 'allocation must preserve StageManager execution authority');
assert.match(allocation, /governanceAdmitted:\s*true/, 'allocation must require governance admission');
assert.match(allocation, /internally_generated_balance::numeric - \$2::numeric/, 'reservation must atomically debit canonical SELF_FUNDED available balance');
assert.match(allocation, /Only unsubmitted RESERVED capital can be released/, 'submitted or placed capital must never be silently restored at the source');
assert.match(allocation, /delivered_amount_base_units=\$2/, 'placement must record exact destination-delivered base units');
assert.match(allocation, /remaining_destination_base_units/, 'placed system-owned capital must track remaining destination ownership');
assert.doesNotMatch(allocation, /CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i, 'runtime allocation code must not own schema DDL');

assert.match(allocationMigration, /source_amount_base_units numeric\(78,0\)/, 'allocation migration must preserve exact source base units');
assert.match(allocationMigration, /delivered_amount_base_units numeric\(78,0\)/, 'allocation migration must keep delivered destination units distinct from source units');
assert.match(allocationMigration, /authority_evidence jsonb NOT NULL/, 'allocation migration must preserve authority evidence');
assert.match(overflowSchema, /026_cryptocrawler_system_capital_allocations\.sql/, 'Overflow runtime schema must provision system-capital allocations');
assert.match(overflowSchema, /public\.cryptocrawler_system_capital_allocations/, 'Overflow runtime admission must require the allocation table');
assert.match(dockerfile, /026_cryptocrawler_system_capital_allocations\.sql/, 'production image must bundle the system-capital allocation migration');

console.log('[self-funded-capital-authority] PASS: raw wallet authority removed; verified retained capital is provenance-backed, allocation-locked, and every CEX reservation is capped by settlement-confirmed system ownership');
