const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const refund = read('server/services/cryptocrawl/integration/bps-private-refund-evidence.ts');
const decomposition = read('server/services/cryptocrawl/integration/bps-decomposition-observability.ts');
const ledger = read('docs/cryptocrawler/PROGRESS_CONSOLIDATION_20260905.md');

// Use the current official Flashbots relay/refund surface and the already-existing
// secret-backed auth identity; this wave must not introduce another API key or
// persist/auth-generate a trading secret.
assert.match(refund, /const FLASHBOTS_RELAY_URL = 'https:\/\/relay\.flashbots\.net'/);
assert.match(refund, /getOrCreateFlashbotsAuthPrivateKey/);
assert.match(refund, /walletFromPrivateKey/);
assert.match(refund, /'x-flashbots-signature'/);
assert.match(refund, /signMessage\(ethers\.utils\.id\(body\)\)/);
assert.ok(!/PRIVATE_REFUND_API_KEY|FLASHBOTS_REFUND_API_KEY|MEV_REFUND_API_KEY/.test(refund), 'Private-refund evidence must not require a new API key');
assert.ok(!/Wallet\.createRandom\(\)/.test(refund), 'Refund evidence must reuse the canonical persistent Flashbots auth identity');

// Detailed fee-refund evidence is paginated and delayed. Keep retrieval bounded
// and low-frequency rather than repeatedly hammering the relay for unchanged data.
assert.match(refund, /'flashbots_getFeeRefundsByRecipient'/);
assert.match(refund, /CRYPTOCRAWL_PRIVATE_REFUND_MAX_PAGES/);
assert.match(refund, /Math\.max\(1, Math\.min\(4/);
assert.match(refund, /CRYPTOCRAWL_PRIVATE_REFUND_POLL_MS/);
assert.match(refund, /Math\.max\(15 \* 60_000, Math\.min\(6 \* 60 \* 60_000/);

// A pending/forecast refund is not execution economics. Only money Flashbots
// reports RECEIVED may be transformed into realized BPS, so this cannot make an
// otherwise-negative trade executable before settlement.
assert.match(refund, /status: 'pending' \| 'received'/);
assert.match(refund, /\.filter\(row => row\.status === 'received'\)/);
assert.match(refund, /export function measuredReceivedPrivateRefundBps/);
assert.match(refund, /deterministicAdmissionCredit: false/);
assert.match(refund, /pendingRefundAdmissionCredit: false/);
assert.match(refund, /forecastRefundAdmissionCredit: false/);
assert.ok(!/deterministicAdmissionCredit: true/.test(refund), 'Refund evidence must never create deterministic pre-execution credit');
assert.ok(!/executionAuthority: true/.test(refund), 'Refund evidence must not become an execution authority');

// Runtime BPS observability must consume this evidence through the existing
// decomposition surface, not a competing economics engine.
assert.match(decomposition, /ensureBpsPrivateRefundEvidenceWiring/);
assert.match(decomposition, /getPrivateRefundEvidenceSnapshot/);
assert.match(decomposition, /privateRefundEconomicAuthority: 'received_terminal_evidence_only'/);
assert.match(decomposition, /pendingPrivateRefundEconomicAuthority: false/);
assert.match(decomposition, /authority: 'telemetry_only'/);
assert.match(decomposition, /executionAuthority: false/);

// Preserve the explicit anti-duplication ledger so future work does not replay
// solved PRs or wholesale-merge the stale #520 branch.
assert.match(ledger, /Completed work — do not re-identify or rebuild/);
assert.match(ledger, /#520 — intentionally remains unmerged/);
assert.match(ledger, /never merge\/rebase it wholesale/);
assert.match(ledger, /do not refetch large production logs/i);

console.log('[bps-private-refund-wave4] PASS: keyless Flashbots realized-refund evidence is bounded, received-only, non-authoritative for admission, integrated into the existing BPS telemetry, and protected by the CryptoCrawler anti-duplication ledger');
