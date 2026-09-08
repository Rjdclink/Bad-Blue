#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(`[batch-1-capability] ${message}`);
};

const spotProducts = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
const okxPrivate = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const supabaseAdmission = read('server/services/cryptocrawl/integration/cryptara-supabase-admission-worker.ts');

// Venue tickers are not global asset identities. EDGE is currently two different
// assets on Kraken and OKX and must never share one canonical cross-venue symbol.
assert(/kraken:\s*Object\.freeze\(\{[^}]*EDGE:\s*'DEFINITIVE'/.test(spotProducts), 'Kraken EDGE must canonicalize to Definitive');
assert(/okx:\s*Object\.freeze\(\{[^}]*EDGE:\s*'EDGEX'/.test(spotProducts), 'OKX EDGE must canonicalize to edgeX');
assert(!/kraken:\s*Object\.freeze\(\{[^}]*EDGE:\s*'EDGEX'/.test(spotProducts), 'Kraken EDGE cannot alias to OKX edgeX');
assert(!/okx:\s*Object\.freeze\(\{[^}]*EDGE:\s*'DEFINITIVE'/.test(spotProducts), 'OKX EDGE cannot alias to Kraken Definitive');

// Preserve previously valid venue aliases and broad product semantics.
assert(/LUNA:\s*'LUNC'/.test(spotProducts) && /UST:\s*'USTC'/.test(spotProducts), 'Kraken legacy canonical aliases must be preserved');
assert(/LIT:\s*'LIGHTER'/.test(spotProducts) && /LUNA:\s*'WLUNA'/.test(spotProducts), 'OKX legacy canonical aliases must be preserved');
assert(/parsed\s*>\s*18/.test(spotProducts), 'product decimal handling must remain general through 18 decimals');
assert(/netProfitUsd\s*<=\s*0/.test(spotProducts), 'exact positive net profit, including sub-one-BPS, must remain admissible');
assert(/quoteCurrencyAllowlistUsed:\s*false/.test(spotProducts), 'quote-currency allowlist must remain disabled');

// The production rate repair is configuration-backed and route-local to OKX.
assert(okxPrivate.includes('CRYPTO_OKX_ACCOUNT_BUCKET_CAPACITY'), 'OKX account bucket capacity must remain configurable');
assert(okxPrivate.includes('CRYPTO_OKX_ACCOUNT_READ_MIN_INTERVAL_MS'), 'OKX account-read pacing must remain configurable');
assert(/if \(path\.startsWith\('\/api\/v5\/account\/'\)\) return 'account_read'/.test(okxPrivate), 'OKX account endpoints must remain isolated to the account-read lane');

// Supabase pressure repair uses the existing adaptive authority rather than a
// second pool or a global execution switch.
assert(supabaseAdmission.includes('CRYPTARA_DB_HEALTHY_SUCCESSES_TO_GROW'), 'Supabase recovery hysteresis must remain configurable');
assert(supabaseAdmission.includes('CRYPTARA_DB_MIN_COOLDOWN_MS') && supabaseAdmission.includes('CRYPTARA_DB_MAX_COOLDOWN_MS'), 'Supabase pressure cooldown bounds must remain configurable');
assert(/additionalConnectionBudget:\s*0/.test(supabaseAdmission), 'Supabase repair must not add a second connection budget');
assert(!supabaseAdmission.includes('process.env.NO_EXECUTION ='), 'Supabase resource governor cannot mutate global execution posture');

console.log('[batch-1-capability] PASS');
