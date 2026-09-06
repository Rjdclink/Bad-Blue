'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const targetPath = path.join(root, 'server/services/cryptocrawl/optimization/fee-surface-hyperdynamic-strategy-engine.ts');
const source = fs.readFileSync(targetPath, 'utf8');

function must(pattern, message) {
  if (!pattern.test(source)) throw new Error(`[verify-nix-gen-bps-surplus-objective] ${message}`);
}

must(/zero_or_negative_exchange_fee_surface/, 'explicit zero-or-negative exchange-fee strategy is missing');
must(/combinedFeeBps\s*<=\s*0/, 'zero/negative combined exchange-fee surface is not measured');
must(/feeFreshnessScore\s*>=\s*0\.75/, 'surplus surface must require fresh authenticated fee evidence');
must(/drive_measured_exchange_fee_cost_to_zero_or_negative_while_preserving_positive_all_in_net/, 'cost-surplus objective is missing');
must(/canonical execution must still prove strictly positive all-in net economics/i, 'positive all-in execution gate must remain explicit');
must(/executionAuthority:\s*false/, 'strategy layer must not gain execution authority');
must(/syntheticFeeAuthority:\s*false/, 'strategy layer must not gain synthetic fee authority');
must(/unverified_rebate_assumption/, 'unverified rebates must remain prohibited');
must(/wash_volume/, 'wash-volume behavior must remain prohibited');
must(/self_trade/, 'self-trading must remain prohibited');
must(/artificial_tier_volume/, 'artificial fee-tier volume must remain prohibited');

console.log('[verify-nix-gen-bps-surplus-objective] PASS');
