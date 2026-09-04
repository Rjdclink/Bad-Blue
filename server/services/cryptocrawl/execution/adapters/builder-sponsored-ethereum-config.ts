import { ethers } from 'ethers';

function address(value: string): string {
  return ethers.utils.getAddress(value.toLowerCase());
}

/**
 * Ethereum L1 is the first builder-sponsored bootstrap surface because Titan and
 * Quasar document builder-funded gas sponsorship there. Keep these identities
 * explicit and fail-closed rather than borrowing unrelated bridge-chain config.
 */
export const BUILDER_SPONSORED_ETHEREUM = Object.freeze({
  chain: 'ethereum' as const,
  chainId: 1,
  balancerV2Vault: address('0xBA12222222228d8Ba445958a75a0704d566BF2C8'),
  usdc: address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
  usdt: address('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
  weth: address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  foundryCreate2Deployer: address('0x4e59b44847b379578588920cA78FbF26c0B4956C'),
  foundryCreate2DeployerCodeHash: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989',
});
