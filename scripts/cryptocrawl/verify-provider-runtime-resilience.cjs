'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const gas = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/bridge/gas-oracle.ts'), 'utf8');
const coinbase = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts'), 'utf8');
const core = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/core-runtime.ts'), 'utf8');

const checks = [
  ['Gas refresh uses all-settled chain isolation', gas.includes('Promise.allSettled(chains.map(chain => this.getGasPrice(chain)))')],
  ['Failed chain gas evidence is discarded', gas.includes('this.gasPrices.delete(chain)')],
  ['Current refresh requires at least one live gas success', gas.includes("throw new Error('GasOracle has no live gas evidence from the current refresh')")],
  ['Cheapest-chain path still refreshes before selection', gas.indexOf('await this.updateAllGasPrices();') < gas.indexOf('let cheapestChain: ChainId | null = null;')],
  ['Coinbase CDP key id alias recognized', coinbase.includes('process.env.CDP_API_KEY_ID')],
  ['Coinbase CDP private key alias recognized', coinbase.includes('process.env.CDP_API_KEY_PRIVATE_KEY')],
  ['Coinbase generic key-name alias recognized', coinbase.includes('process.env.KEY_NAME')],
  ['Coinbase generic key-secret alias recognized', coinbase.includes('process.env.KEY_SECRET')],
  ['Canonical core retains topology-local provider failure contract', core.includes('optionalProviderFailureBlocksCore: false')],
  ['No live execution flag forced by either changed runtime module', !gas.includes("CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'") && !coinbase.includes("CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) {
  console.error(`Provider runtime resilience verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('Provider runtime resilience verification passed.');
