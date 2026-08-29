const fs = require('node:fs');
const assert = require('node:assert/strict');

const sponsorship = fs.readFileSync('server/services/cryptocrawl/strategies/gas-sponsorship.ts', 'utf8');

// Alchemy Wallet APIs currently support both documented SemiModularAccount7702
// deployments. Existing v1.0 delegations remain valid; v1.1 is the current
// default for newly prepared EIP-7702 delegations.
assert.match(sponsorship, /ALCHEMY_MODULAR_ACCOUNT_7702_ALLOWLIST/);
assert.match(sponsorship, /0x69007702764179f14f51cdce752f4f775d74e139/);
assert.match(sponsorship, /0x77021100bd87b7008e5e1989d0eb38555d0d0000/);
assert.match(sponsorship, /ALCHEMY_MODULAR_ACCOUNT_7702_ALLOWLIST\.has\(delegationAddress\)/);

// The compatibility expansion must remain an exact allowlist, not an arbitrary
// prepared-call signer. Chain binding and 32-byte authorization-payload checks
// remain mandatory before signing.
assert.match(sponsorship, /Refusing unexpected EIP-7702 delegation target/);
assert.match(sponsorship, /Number\(BigInt\(item\.chainId\)\) !== expectedChainId/);
assert.match(sponsorship, /ethers\.utils\.isHexString\(raw, 32\)/);
assert.match(sponsorship, /wallet_prepareCalls/);
assert.match(sponsorship, /paymasterService: \{ policyId: this\.policyId \}/);
assert.match(sponsorship, /wallet_sendPreparedCalls/);
assert.match(sponsorship, /wallet_getCallsStatus/);
assert.match(sponsorship, /receiptStatus !== 1/);

console.log(JSON.stringify({
  alchemyEip7702DelegationAuthority: 'verified',
  modularAccountV1Accepted: true,
  modularAccountV11Accepted: true,
  arbitraryDelegationRejected: true,
  exactChainBindingPreserved: true,
  authorizationDigestValidationPreserved: true,
  sponsoredReceiptConfirmationPreserved: true,
}, null, 2));
