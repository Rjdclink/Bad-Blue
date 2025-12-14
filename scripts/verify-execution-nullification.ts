import { readFileSync } from 'fs';
import { resolve } from 'path';

function read(pathFromRepoRoot: string): string {
  return readFileSync(resolve(process.cwd(), pathFromRepoRoot), 'utf8');
}

function mustContain(path: string, needles: string[]) {
  const text = read(path);
  for (const n of needles) {
    if (!text.includes(n)) {
      console.error(`[FAIL] ${path} missing required text: ${JSON.stringify(n)}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`[OK] ${path}`);
}

function main() {
  // 1) Policy hard-false
  mustContain('shared/cryptoExecutionPolicy.ts', ['export const CRYPTO_EXECUTION_RELEASED = false as const']);

  // 2) Hard disables on primary execution entrypoints
  mustContain('server/services/cryptocrawl/faucet/autonomous-faucet.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.autonomous-faucet.runAutonomousLoop')",
  ]);

  mustContain('server/services/cryptocrawl/execution/index.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.execution.executeWithMaxProfit')",
  ]);

  mustContain('server/services/cryptocrawl/execution/ultra-low-latency-executor.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.executeInstant')",
    "assertCryptoExecutionReleased('cryptocrawl.execution.ultra-low-latency.executeMultiPath')",
  ]);

  mustContain('server/services/cryptocrawl/execution/multi-relay-submitter.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.execution.multi-relay.initialize')",
  ]);

  mustContain('services/cryptocrawler-executor/index.ts', [
    "assertCryptoExecutionReleased('cryptocrawler-executor.start')",
  ]);

  // 3) Disable tx broadcast helpers
  mustContain('server/services/cryptocrawl/api/blockchain-providers.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.api.blockchain-providers.sendTransaction')",
  ]);

  // 4) Disable withdrawal manager
  mustContain('server/services/cryptocrawl/bridge/withdraw-deposit.ts', [
    "assertCryptoExecutionReleased('cryptocrawl.bridge.withdraw-deposit.withdraw')",
  ]);

  // 5) Ensure faucet cannot be started via API and daily cap remains locked
  mustContain('server/services/cryptocrawl/api/dashboard-api.ts', [
    'const DAILY_CAP_USD = 200;',
    "message: 'Execution disabled: faucet is forced OFF'",
  ]);

  console.log(process.exitCode ? '\nVERDICT: FAIL' : '\nVERDICT: PASS');
}

main();

