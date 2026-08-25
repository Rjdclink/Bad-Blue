import { Wallet, utils } from 'ethers';

export type ConfiguredWalletAddressSource = 'execution_wallet' | 'bridge_wallet';

export interface ConfiguredWalletAddress {
  address: string | null;
  source: ConfiguredWalletAddressSource | null;
  reason?: string;
}

export function normalizePrivateKey(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;

  let normalized = value.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.startsWith('0x') || normalized.startsWith('0X')) normalized = normalized.slice(2);
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) return null;
  return `0x${normalized}`;
}

export function walletFromPrivateKey(value: string | undefined): Wallet {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY must be a 32-byte hexadecimal private key');
  return new Wallet(privateKey);
}

export function resolveConfiguredWalletAddress(environment: NodeJS.ProcessEnv = process.env): ConfiguredWalletAddress {
  const configuredPrivateKey = normalizePrivateKey(environment.WALLET_PRIVATE_KEY);
  const configuredBridgeAddress = environment.BRIDGE_WALLET_ADDRESS?.trim();

  if (configuredPrivateKey) {
    const executionAddress = walletFromPrivateKey(configuredPrivateKey).address;
    if (configuredBridgeAddress) {
      try {
        if (executionAddress !== utils.getAddress(configuredBridgeAddress)) {
          return { address: null, source: null, reason: 'WALLET_PRIVATE_KEY does not match BRIDGE_WALLET_ADDRESS' };
        }
      } catch {
        return { address: null, source: null, reason: 'BRIDGE_WALLET_ADDRESS must be a valid EVM address' };
      }
    }
    return { address: executionAddress, source: 'execution_wallet' };
  }

  if (!configuredBridgeAddress) {
    return { address: null, source: null, reason: 'Neither WALLET_PRIVATE_KEY nor BRIDGE_WALLET_ADDRESS is configured' };
  }

  try {
    return { address: utils.getAddress(configuredBridgeAddress), source: 'bridge_wallet' };
  } catch {
    return { address: null, source: null, reason: 'BRIDGE_WALLET_ADDRESS must be a valid EVM address' };
  }
}

export function assertConfiguredWalletAddress(privateKey: string, configuredAddress = process.env.BRIDGE_WALLET_ADDRESS): string {
  const wallet = walletFromPrivateKey(privateKey);
  const expectedAddress = configuredAddress?.trim();
  if (!expectedAddress) return wallet.address;

  let normalizedExpected: string;
  try {
    normalizedExpected = utils.getAddress(expectedAddress);
  } catch {
    throw new Error('BRIDGE_WALLET_ADDRESS must be a valid EVM address');
  }
  if (wallet.address !== normalizedExpected) {
    throw new Error('WALLET_PRIVATE_KEY does not match BRIDGE_WALLET_ADDRESS');
  }
  return wallet.address;
}