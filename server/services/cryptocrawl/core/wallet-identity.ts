import { Wallet, utils } from 'ethers';

export type ConfiguredWalletAddressSource = 'execution_wallet' | 'bridge_wallet';

export interface ConfiguredWalletAddress {
  address: string | null;
  source: ConfiguredWalletAddressSource | null;
  reason?: string;
}

export interface CanonicalWalletBootstrap {
  executionAddress: string | null;
  terminalPayoutAddress: string | null;
  bridgeAliasInstalled: boolean;
  acrossAliasInstalled: boolean;
  deprecatedVariablesPresent: string[];
}

function normalizeAddress(name: string, value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    return utils.getAddress(normalized);
  } catch {
    throw new Error(`${name} must be a valid EVM address`);
  }
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

export function resolveExecutionWalletAddress(environment: NodeJS.ProcessEnv = process.env): ConfiguredWalletAddress {
  const configuredPrivateKey = normalizePrivateKey(environment.WALLET_PRIVATE_KEY);
  const configuredBridgeAddress = environment.BRIDGE_WALLET_ADDRESS?.trim();

  if (configuredPrivateKey) {
    const executionAddress = walletFromPrivateKey(configuredPrivateKey).address;
    if (configuredBridgeAddress) {
      try {
        if (executionAddress !== utils.getAddress(configuredBridgeAddress)) {
          return { address: null, source: null, reason: 'Legacy BRIDGE_WALLET_ADDRESS does not match the WALLET_PRIVATE_KEY-derived execution wallet' };
        }
      } catch {
        return { address: null, source: null, reason: 'BRIDGE_WALLET_ADDRESS must be a valid EVM address when retained as a legacy alias' };
      }
    }
    return { address: executionAddress, source: 'execution_wallet' };
  }

  // Preserve observation-only compatibility for installations that historically
  // configured only a bridge address. Live execution still requires WALLET_PRIVATE_KEY.
  if (!configuredBridgeAddress) {
    return { address: null, source: null, reason: 'WALLET_PRIVATE_KEY is not configured' };
  }

  try {
    return { address: utils.getAddress(configuredBridgeAddress), source: 'bridge_wallet', reason: 'Legacy bridge-address-only observation mode; no signing authority is available' };
  } catch {
    return { address: null, source: null, reason: 'BRIDGE_WALLET_ADDRESS must be a valid EVM address' };
  }
}

/** Backward-compatible name retained for existing callers. */
export function resolveConfiguredWalletAddress(environment: NodeJS.ProcessEnv = process.env): ConfiguredWalletAddress {
  return resolveExecutionWalletAddress(environment);
}

export function resolveTerminalPayoutAddress(environment: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeAddress('CRYPTO_PROFIT_WALLET_ADDRESS', environment.CRYPTO_PROFIT_WALLET_ADDRESS);
}

export function resolveOperationalProfitRecipient(
  explicitRecipient?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const privateKey = normalizePrivateKey(environment.WALLET_PRIVATE_KEY);
  if (privateKey) return walletFromPrivateKey(privateKey).address;

  // Test/offline builders may supply an explicit recipient without a live signer.
  const explicit = normalizeAddress('operational profit recipient', explicitRecipient);
  if (explicit) return explicit;

  const configured = resolveExecutionWalletAddress(environment);
  if (!configured.address) throw new Error(configured.reason || 'No operational CryptoCrawler wallet is configured');
  return configured.address;
}

export function assertConfiguredWalletAddress(
  privateKey: string,
  configuredAddress = process.env.BRIDGE_WALLET_ADDRESS,
): string {
  const wallet = walletFromPrivateKey(privateKey);
  const expectedAddress = normalizeAddress('BRIDGE_WALLET_ADDRESS', configuredAddress);
  if (expectedAddress && wallet.address !== expectedAddress) {
    throw new Error('Legacy BRIDGE_WALLET_ADDRESS does not match WALLET_PRIVATE_KEY');
  }

  const acrossDepositor = normalizeAddress('CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS', process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS);
  if (acrossDepositor && wallet.address !== acrossDepositor) {
    throw new Error('CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS does not match WALLET_PRIVATE_KEY');
  }

  const legacyBridgeSigner = normalizePrivateKey(process.env.BRIDGE_SIGNER_PRIVATE_KEY);
  if (process.env.BRIDGE_SIGNER_PRIVATE_KEY && !legacyBridgeSigner) {
    throw new Error('Deprecated BRIDGE_SIGNER_PRIVATE_KEY is present but invalid');
  }
  if (legacyBridgeSigner && walletFromPrivateKey(legacyBridgeSigner).address !== wallet.address) {
    throw new Error('Deprecated BRIDGE_SIGNER_PRIVATE_KEY conflicts with WALLET_PRIVATE_KEY');
  }
  return wallet.address;
}

/**
 * Establish one operational signer/wallet identity while preserving legacy env
 * names only as aliases for older bridge code. CRYPTO_PROFIT_WALLET_ADDRESS is
 * deliberately excluded: it is the terminal cash-out destination, never an
 * operational trading/bridge signer identity.
 */
export function installCanonicalWalletConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CanonicalWalletBootstrap {
  const deprecatedVariablesPresent = ['BRIDGE_WALLET_ADDRESS', 'BRIDGE_SIGNER_PRIVATE_KEY', 'WALLET_PUBLIC_KEY']
    .filter(name => Boolean(environment[name]?.trim()));

  const privateKey = normalizePrivateKey(environment.WALLET_PRIVATE_KEY);
  if (environment.WALLET_PRIVATE_KEY && !privateKey) {
    throw new Error('WALLET_PRIVATE_KEY is not a valid 32-byte EVM private key');
  }

  const terminalPayoutAddress = resolveTerminalPayoutAddress(environment);
  if (!privateKey) {
    return {
      executionAddress: resolveExecutionWalletAddress(environment).address,
      terminalPayoutAddress,
      bridgeAliasInstalled: false,
      acrossAliasInstalled: false,
      deprecatedVariablesPresent,
    };
  }

  const executionAddress = assertConfiguredWalletAddress(privateKey);
  let bridgeAliasInstalled = false;
  let acrossAliasInstalled = false;

  if (!environment.BRIDGE_WALLET_ADDRESS?.trim()) {
    environment.BRIDGE_WALLET_ADDRESS = executionAddress;
    bridgeAliasInstalled = true;
  }
  if (!environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS?.trim()) {
    environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS = executionAddress;
    acrossAliasInstalled = true;
  }

  return {
    executionAddress,
    terminalPayoutAddress,
    bridgeAliasInstalled,
    acrossAliasInstalled,
    deprecatedVariablesPresent,
  };
}
