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
  terminalPayoutReason?: string;
  bridgeAliasInstalled: boolean;
  acrossAliasInstalled: boolean;
  deprecatedVariablesPresent: string[];
}

/**
 * Accept any structurally valid 20-byte EVM address regardless of input casing,
 * then return the canonical EIP-55 checksum form. This deliberately avoids
 * rejecting a valid address merely because a user pasted mixed-case text whose
 * capitalization is not itself a valid checksum.
 */
export function normalizeEvmAddress(name: string, value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${name} must be a 20-byte EVM address (0x plus 40 hexadecimal characters)`);
  }
  return utils.getAddress(normalized.toLowerCase());
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
  if (configuredPrivateKey) {
    return { address: walletFromPrivateKey(configuredPrivateKey).address, source: 'execution_wallet' };
  }

  // Preserve observation-only compatibility for installations that historically
  // configured only a bridge address. Live execution still requires WALLET_PRIVATE_KEY.
  const configuredBridgeAddress = environment.BRIDGE_WALLET_ADDRESS?.trim();
  if (!configuredBridgeAddress) {
    return { address: null, source: null, reason: 'WALLET_PRIVATE_KEY is not configured' };
  }

  try {
    return { address: normalizeEvmAddress('BRIDGE_WALLET_ADDRESS', configuredBridgeAddress), source: 'bridge_wallet', reason: 'Legacy bridge-address-only observation mode; no signing authority is available' };
  } catch {
    return { address: null, source: null, reason: 'Legacy BRIDGE_WALLET_ADDRESS is invalid and no canonical signer is configured' };
  }
}

/** Backward-compatible name retained for existing callers. */
export function resolveConfiguredWalletAddress(environment: NodeJS.ProcessEnv = process.env): ConfiguredWalletAddress {
  return resolveExecutionWalletAddress(environment);
}

export function resolveTerminalPayoutAddress(environment: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return normalizeEvmAddress('CRYPTO_PROFIT_WALLET_ADDRESS', environment.CRYPTO_PROFIT_WALLET_ADDRESS);
  } catch {
    return null;
  }
}

export function resolveOperationalProfitRecipient(
  explicitRecipient?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const privateKey = normalizePrivateKey(environment.WALLET_PRIVATE_KEY);
  if (privateKey) return walletFromPrivateKey(privateKey).address;

  // Test/offline builders may supply an explicit recipient without a live signer.
  const explicit = normalizeEvmAddress('operational profit recipient', explicitRecipient);
  if (explicit) return explicit;

  const configured = resolveExecutionWalletAddress(environment);
  if (!configured.address) throw new Error(configured.reason || 'No operational CryptoCrawler wallet is configured');
  return configured.address;
}

/**
 * Validate an explicitly supplied address against the canonical signer. Legacy
 * environment aliases are not authority and are deliberately not consulted.
 */
export function assertConfiguredWalletAddress(privateKey: string, configuredAddress?: string): string {
  const wallet = walletFromPrivateKey(privateKey);
  const expectedAddress = normalizeEvmAddress('configured wallet address', configuredAddress);
  if (expectedAddress && wallet.address !== expectedAddress) {
    throw new Error('Configured wallet address does not match WALLET_PRIVATE_KEY');
  }
  return wallet.address;
}

/**
 * Establish one operational signer/wallet identity while preserving legacy env
 * names only as in-process aliases for older bridge code. Any historical alias
 * value is repaired to the WALLET_PRIVATE_KEY-derived address. The deprecated
 * duplicate signer/public-key variables are never read as authority.
 *
 * CRYPTO_PROFIT_WALLET_ADDRESS is deliberately excluded: it is the terminal
 * cash-out destination, never an operational trading/bridge signer identity.
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

  const rawTerminalPayout = environment.CRYPTO_PROFIT_WALLET_ADDRESS?.trim();
  const terminalPayoutAddress = resolveTerminalPayoutAddress(environment);
  const terminalPayoutReason = rawTerminalPayout && !terminalPayoutAddress
    ? 'CRYPTO_PROFIT_WALLET_ADDRESS is not a valid 20-byte EVM address; terminal sweep remains disabled while trading can continue'
    : undefined;

  if (!privateKey) {
    return {
      executionAddress: resolveExecutionWalletAddress(environment).address,
      terminalPayoutAddress,
      terminalPayoutReason,
      bridgeAliasInstalled: false,
      acrossAliasInstalled: false,
      deprecatedVariablesPresent,
    };
  }

  const executionAddress = walletFromPrivateKey(privateKey).address;
  const bridgeAliasInstalled = environment.BRIDGE_WALLET_ADDRESS?.trim() !== executionAddress;
  const acrossAliasInstalled = environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS?.trim() !== executionAddress;

  // Compatibility only: existing bridge code still reads these names, but they
  // can no longer represent a second wallet or signer identity.
  environment.BRIDGE_WALLET_ADDRESS = executionAddress;
  environment.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS = executionAddress;

  return {
    executionAddress,
    terminalPayoutAddress,
    terminalPayoutReason,
    bridgeAliasInstalled,
    acrossAliasInstalled,
    deprecatedVariablesPresent,
  };
}
