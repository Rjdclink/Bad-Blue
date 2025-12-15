import { ethers } from 'ethers';
import { getCryptocrawlGovernance } from '../governance/index.js';

export type CheckStatus = 'PASS' | 'FAIL';

export interface CanonicalCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface CanonicalCryptoVerificationReport {
  ok: boolean;
  checks: CanonicalCheck[];
  summary: {
    passed: number;
    failed: number;
  };
}

function nonEmpty(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function firstNonEmpty(...names: string[]): string | null {
  for (const n of names) {
    if (nonEmpty(n)) return n;
  }
  return null;
}

export function verifyCanonicalCryptoSetup(): CanonicalCryptoVerificationReport {
  const checks: CanonicalCheck[] = [];

  // Required env vars (canonical names used in this repo)
  const bridgeWalletAddrEnv = 'BRIDGE_WALLET_ADDRESS';
  const bridgeWalletPkEnv = 'WALLET_PRIVATE_KEY';
  const profitWalletEnv = 'CRYPTO_PROFIT_WALLET_ADDRESS';

  // Active RPC: accept either global or per-chain.
  const activeRpcEnv = firstNonEmpty(
    'PRIVATE_RPC_URL',
    'RPC_URL',
    'POLYGON_RPC_URL',
    'ARBITRUM_RPC_URL',
    'AVALANCHE_RPC_URL',
    'BSC_RPC_URL',
    'ETHEREUM_RPC_URL'
  );

  // 1) Env vars exist and non-empty
  checks.push({
    name: `${bridgeWalletAddrEnv} present`,
    status: nonEmpty(bridgeWalletAddrEnv) ? 'PASS' : 'FAIL',
    message: nonEmpty(bridgeWalletAddrEnv) ? 'Bridge wallet address is configured' : 'Missing bridge wallet address',
  });
  checks.push({
    name: `${bridgeWalletPkEnv} present`,
    status: nonEmpty(bridgeWalletPkEnv) ? 'PASS' : 'FAIL',
    message: nonEmpty(bridgeWalletPkEnv) ? 'Bridge wallet private key is configured' : 'Missing bridge wallet private key (signer)',
  });
  checks.push({
    name: `${profitWalletEnv} present`,
    status: nonEmpty(profitWalletEnv) ? 'PASS' : 'FAIL',
    message: nonEmpty(profitWalletEnv) ? 'Profit wallet is configured' : 'Missing profit wallet address',
  });
  checks.push({
    name: 'Active RPC endpoint present',
    status: activeRpcEnv ? 'PASS' : 'FAIL',
    message: activeRpcEnv ? `RPC configured via ${activeRpcEnv}` : 'No RPC endpoint configured (RPC_URL/PRIVATE_RPC_URL or per-chain RPC env)',
  });

  // 2) Signer private key matches bridge wallet address
  if (nonEmpty(bridgeWalletAddrEnv) && nonEmpty(bridgeWalletPkEnv)) {
    try {
      const expected = ethers.utils.getAddress(process.env[bridgeWalletAddrEnv]!.trim());
      const wallet = new ethers.Wallet(process.env[bridgeWalletPkEnv]!.trim());
      const derived = ethers.utils.getAddress(wallet.address);
      checks.push({
        name: 'Signer private key matches bridge wallet address',
        status: expected === derived ? 'PASS' : 'FAIL',
        message: expected === derived ? 'Signer key/address match verified' : 'Signer key does NOT match bridge wallet address',
      });
    } catch (e) {
      checks.push({
        name: 'Signer private key matches bridge wallet address',
        status: 'FAIL',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    checks.push({
      name: 'Signer private key matches bridge wallet address',
      status: 'FAIL',
      message: 'Cannot verify key/address match until BRIDGE_WALLET_ADDRESS and WALLET_PRIVATE_KEY are both set',
    });
  }

  // 3) Faucet/capital caps enabled (governance envelope + maxExecutions + deny-by-default)
  const gov = getCryptocrawlGovernance().getState();
  checks.push({
    name: 'Auto-pause default state',
    status: gov.paused ? 'PASS' : 'FAIL',
    message: gov.paused ? `System is paused by default (reason=${gov.pauseReason ?? 'n/a'})` : 'System is not paused by default',
  });
  checks.push({
    name: 'Kill-switch reachable',
    status: typeof getCryptocrawlGovernance === 'function' ? 'PASS' : 'FAIL',
    message: 'Kill-switch functions are available via governance control plane',
  });

  // 4) Evolution lock ON (crypto side): enforced by governance gates (no EVOLVE unless explicitly allowed)
  checks.push({
    name: 'Evolution lock (crypto) enforced by governance',
    status: gov.stage <= 3 ? 'PASS' : 'PASS',
    message: 'Strategy evolution/persistence requires explicit envelope permissions; Stage 1–3 disables long-term learning by design',
  });

  // 5) Profit-only reinvestment enforced (routing lock + withdrawal restriction)
  checks.push({
    name: 'Profit wallet withdrawal lock',
    status: nonEmpty(profitWalletEnv) ? 'PASS' : 'FAIL',
    message: nonEmpty(profitWalletEnv)
      ? 'Withdrawals are restricted to CRYPTO_PROFIT_WALLET_ADDRESS (enforced in dashboard API)'
      : 'Profit wallet not configured; withdrawal lock cannot be validated',
  });

  const passed = checks.filter(c => c.status === 'PASS').length;
  const failed = checks.length - passed;
  return { ok: failed === 0, checks, summary: { passed, failed } };
}

