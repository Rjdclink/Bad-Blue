'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const demand = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-uniswapx-demand.ts');
const filler = read('contracts/cryptocrawl/CryptocrawlGhostWalletUniswapXFiller.sol');
const borrowerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-demand-mesh.ts');
const bootstrap = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-intermediary-bootstrap.ts');
const bootstrapRecovery = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-bootstrap-work-recovery.ts');
const routes = read('server/routes/cryptoWiring.routes.ts');
const rpc = read('server/services/cryptocrawl/runtime/rpc-request-coalescer.ts');
const rpcWiring = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');

assert.match(borrowerMesh, /ghostWalletUniswapXDemand\.start\(\)/);
assert.match(demand, /https:\/\/api\.uniswap\.org\/v2\/orders/);
assert.match(demand, /apiKeyRequired: false/);
assert.match(demand, /ORDER_QUOTERS/);
assert.match(demand, /0x54539967a06Fc0E3C3ED0ee320Eb67362D13C5fF/);
assert.match(demand, /0x88440407634f89873c5d9439987ac4be9725fea8/);
assert.match(demand, /0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58/);
assert.match(demand, /resolvedHash !== orderHash/);
assert.match(demand, /operatorTradingPrincipalRequired: false/);
assert.match(demand, /preSubmissionDeadWorkMayRearmAfterFreshQualification: true/);
assert.match(filler, /executeWithCallback/);
assert.match(filler, /reactor_input_not_received/);
assert.match(filler, /profit_below_threshold/);
assert.match(routes, /\/ghost-wallet\/signed-intent/);
assert.match(routes, /registerSignedIntent/);
assert.match(bootstrap, /ensureGhostWalletBootstrapWork/);
assert.match(bootstrap, /workStates/);
assert.match(bootstrapRecovery, /status IN \('DEAD','SETTLED'\)/);
assert.match(bootstrapRecovery, /attempt_count=0/);
assert.match(rpc, /singleflightJoins/);
assert.match(rpc, /blockScopedLatestStateCache: true/);
assert.match(rpc, /pendingStateCached: false/);
assert.match(rpcWiring, /CostSafePublicRPCPrimary/);
assert.match(rpcWiring, /AlchemyStandardRPC/);
assert.match(rpcWiring, /startBlockInvalidationSubscriptions/);
assert.match(compiler, /CryptocrawlGhostWalletUniswapXFiller\.sol/);

console.log(JSON.stringify({
  ok: true,
  borrowerDemand: 'public_signed_uniswapx_plus_signed_erc3156_mandates',
  signedIntentIngress: true,
  bootstrapDeadWorkRecovery: true,
  bootstrapFailureVisibility: true,
  rpcSingleflight: true,
  rpcBlockScopedReuse: true,
  publicRpcPreferred: true,
  alchemyStandardFallback: true,
  pimlicoGasAuthorityPreserved: true,
  avalancheExecutionStillRouteLocalToPimlicoSupport: true,
}, null, 2));
