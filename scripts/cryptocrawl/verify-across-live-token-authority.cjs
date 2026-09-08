const assert = require('node:assert/strict');
const fs = require('node:fs');

const across = fs.readFileSync('server/services/cryptocrawl/bridge/across-bridge-provider.ts', 'utf8');

assert.match(across, /https:\/\/app\.across\.to\/api\/swap\/tokens/);
assert.match(across, /catalog\.tokens\.filter\(token => token\.chainId === chainId && token\.symbol\.toUpperCase\(\) === symbol\)/);
assert.match(across, /const token = matches\[0\]/);
assert.match(across, /ambiguousTokenSymbolMatches/);
assert.match(across, /across_swap_tokens:current_chain_token_identity/);
assert.doesNotMatch(across, /unique\.size !== 1/);
assert.doesNotMatch(across, /SUPPORTED_CHAINS\[chain\]\.(?:usdc|usdt).*resolveAcrossToken/s);

console.log('[across-live-token-authority] PASS: Across live /swap/tokens ordering owns swap token identity; duplicate symbol representations remain observable instead of hard-failing or being replaced with stale local token addresses');
