/**
 * MetaMask Wallet Connection Hook
 * Provides wallet connection functionality for the CryptoCrawler dashboard
 */

import { useState, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      removeListener: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  balance: string | null;
  isMetaMaskInstalled: boolean;
  isConnecting: boolean;
  error: string | null;
}

export interface UseWalletReturn extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
}

// Chain configurations
export const SUPPORTED_CHAINS: Record<number, { name: string; symbol: string; rpcUrl: string }> = {
  1: { name: 'Ethereum', symbol: 'ETH', rpcUrl: 'https://eth.llamarpc.com' },
  137: { name: 'Polygon', symbol: 'MATIC', rpcUrl: 'https://polygon.llamarpc.com' },
  42161: { name: 'Arbitrum', symbol: 'ETH', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
  10: { name: 'Optimism', symbol: 'ETH', rpcUrl: 'https://mainnet.optimism.io' },
  56: { name: 'BSC', symbol: 'BNB', rpcUrl: 'https://bsc-dataseed.binance.org' },
  43114: { name: 'Avalanche', symbol: 'AVAX', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc' },
};

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    chainId: null,
    balance: null,
    isMetaMaskInstalled: false,
    isConnecting: false,
    error: null,
  });

  // Check if MetaMask is installed
  useEffect(() => {
    const checkMetaMask = () => {
      const installed = typeof window !== 'undefined' && !!window.ethereum?.isMetaMask;
      setState(prev => ({ ...prev, isMetaMaskInstalled: installed }));
    };
    
    checkMetaMask();
    
    // Check if already connected
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
        if (accounts.length > 0) {
          handleAccountsChanged(accounts);
        }
      }).catch(console.error);
    }
  }, []);

  // Handle account changes
  const handleAccountsChanged = useCallback(async (accounts: string[]) => {
    if (accounts.length === 0) {
      setState(prev => ({
        ...prev,
        isConnected: false,
        address: null,
        balance: null,
      }));
    } else {
      const address = accounts[0];
      let balance = null;
      
      try {
        const balanceHex = await window.ethereum?.request({
          method: 'eth_getBalance',
          params: [address, 'latest'],
        });
        // Convert from wei to ETH (simplified)
        balance = (parseInt(balanceHex, 16) / 1e18).toFixed(4);
      } catch (e) {
        console.error('Failed to get balance:', e);
      }
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        address,
        balance,
        error: null,
      }));
    }
  }, []);

  // Handle chain changes
  const handleChainChanged = useCallback((chainIdHex: string) => {
    const chainId = parseInt(chainIdHex, 16);
    setState(prev => ({ ...prev, chainId }));
    // Refresh balance on chain change
    if (state.address) {
      handleAccountsChanged([state.address]);
    }
  }, [state.address, handleAccountsChanged]);

  // Set up event listeners
  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Get initial chain
    window.ethereum.request({ method: 'eth_chainId' }).then((chainIdHex: string) => {
      setState(prev => ({ ...prev, chainId: parseInt(chainIdHex, 16) }));
    }).catch(console.error);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [handleAccountsChanged, handleChainChanged]);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState(prev => ({ ...prev, error: 'MetaMask not installed' }));
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      await handleAccountsChanged(accounts);
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message || 'Failed to connect',
      }));
    } finally {
      setState(prev => ({ ...prev, isConnecting: false }));
    }
  }, [handleAccountsChanged]);

  // Disconnect (just clear local state - MetaMask doesn't have a real disconnect)
  const disconnect = useCallback(() => {
    setState(prev => ({
      ...prev,
      isConnected: false,
      address: null,
      balance: null,
    }));
  }, []);

  // Switch chain
  const switchChain = useCallback(async (chainId: number) => {
    if (!window.ethereum) return;

    const chainIdHex = `0x${chainId.toString(16)}`;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (error: any) {
      // Chain not added, try to add it
      if (error.code === 4902 && SUPPORTED_CHAINS[chainId]) {
        const chain = SUPPORTED_CHAINS[chainId];
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainIdHex,
              chainName: chain.name,
              nativeCurrency: {
                name: chain.symbol,
                symbol: chain.symbol,
                decimals: 18,
              },
              rpcUrls: [chain.rpcUrl],
            }],
          });
        } catch (addError) {
          console.error('Failed to add chain:', addError);
        }
      }
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    switchChain,
  };
}

// Format address for display
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Get chain name
export function getChainName(chainId: number | null): string {
  if (!chainId) return 'Unknown';
  return SUPPORTED_CHAINS[chainId]?.name || `Chain ${chainId}`;
}
