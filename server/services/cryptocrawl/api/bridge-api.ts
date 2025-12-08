import express, { Request, Response } from 'express';
import { balanceMonitor, gasOracle, networkHealth } from './index';

const router = express.Router();

/**
 * GET /api/bridge/balances
 * Returns all token balances for the configured wallet across all chains
 */
router.get('/balances', async (req: Request, res: Response) => {
  try {
    const balances = await balanceMonitor.getAllBalances();
    const totalPortfolio = await balanceMonitor.getTotalPortfolioValue();

    res.json({
      success: true,
      data: {
        balances,
        totalPortfolio,
        timestamp: Date.now()
      }
    });
  } catch (error: any) {
    console.error('Error fetching balances:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch balances'
    });
  }
});

/**
 * GET /api/bridge/balances/:chain
 * Returns token balances for a specific chain
 */
router.get('/balances/:chain', async (req: Request, res: Response) => {
  try {
    const { chain } = req.params;
    
    if (!['polygon', 'arbitrum', 'avalanche', 'bsc'].includes(chain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid chain. Must be one of: polygon, arbitrum, avalanche, bsc'
      });
    }

    const balance = await balanceMonitor.getBalance(chain as any);

    res.json({
      success: true,
      data: balance
    });
  } catch (error: any) {
    console.error(`Error fetching balance for ${req.params.chain}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch balance'
    });
  }
});

/**
 * GET /api/bridge/gas
 * Returns current gas prices for all chains
 */
router.get('/gas', async (req: Request, res: Response) => {
  try {
    await gasOracle.updateAllGasPrices();
    
    const chains = ['polygon', 'arbitrum', 'avalanche', 'bsc'] as const;
    const gasPrices = await Promise.all(
      chains.map(chain => gasOracle.getGasPrice(chain))
    );

    const cheapestChain = await gasOracle.getCheapestChain();

    res.json({
      success: true,
      data: {
        gasPrices,
        cheapestChain,
        timestamp: Date.now()
      }
    });
  } catch (error: any) {
    console.error('Error fetching gas prices:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch gas prices'
    });
  }
});

/**
 * GET /api/bridge/gas/:chain
 * Returns current gas price for a specific chain
 */
router.get('/gas/:chain', async (req: Request, res: Response) => {
  try {
    const { chain } = req.params;
    
    if (!['polygon', 'arbitrum', 'avalanche', 'bsc'].includes(chain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid chain. Must be one of: polygon, arbitrum, avalanche, bsc'
      });
    }

    const gasPrice = await gasOracle.getGasPrice(chain as any);

    res.json({
      success: true,
      data: gasPrice
    });
  } catch (error: any) {
    console.error(`Error fetching gas price for ${req.params.chain}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch gas price'
    });
  }
});

/**
 * GET /api/bridge/health
 * Returns network health status for all chains
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthChecks = await networkHealth.checkAllNetworks();
    const healthyChains = await networkHealth.getHealthyChains();
    const bestChain = await networkHealth.getBestPerformingChain();

    res.json({
      success: true,
      data: {
        networks: healthChecks,
        healthyChains,
        bestPerformingChain: bestChain,
        timestamp: Date.now()
      }
    });
  } catch (error: any) {
    console.error('Error checking network health:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check network health'
    });
  }
});

/**
 * GET /api/bridge/health/:chain
 * Returns network health status for a specific chain
 */
router.get('/health/:chain', async (req: Request, res: Response) => {
  try {
    const { chain } = req.params;
    
    if (!['polygon', 'arbitrum', 'avalanche', 'bsc'].includes(chain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid chain. Must be one of: polygon, arbitrum, avalanche, bsc'
      });
    }

    const health = await networkHealth.checkNetwork(chain as any);

    res.json({
      success: true,
      data: health
    });
  } catch (error: any) {
    console.error(`Error checking health for ${req.params.chain}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check network health'
    });
  }
});

export default router;
