import express from 'express';
import { bridgeManager } from '../bridge/bridge-manager';
import { withdrawDepositManager } from '../bridge/withdraw-deposit';
import { routeOptimizer } from '../bridge/route-optimizer';
import { ChainId } from '../bridge/types';

const router = express.Router();

const VALID_CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
const VALID_TOKENS = ['USDT', 'USDC', 'native'] as const;
const WALLET_ADDRESS = process.env.BRIDGE_WALLET_ADDRESS || '0x3d9bf00bB691793Cd256563fd14819B395306f62';

// Middleware to check if system is running
function requireRunning(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!bridgeManager.isRunning()) {
    return res.status(503).json({ error: 'System not running' });
  }
  next();
}

router.get('/status', (req, res) => {
  res.json({ running: bridgeManager.isRunning(), withdrawEnabled: withdrawDepositManager.isInitialized() });
});

router.post('/start', async (req, res) => {
  try {
    await bridgeManager.start();
    res.json({ success: true, status: 'running' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    await bridgeManager.stop();
    res.json({ success: true, status: 'stopped' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/state', async (req, res) => {
  const state = await bridgeManager.getFullState();
  res.json(state);
});

router.get('/balances', requireRunning, async (req, res) => {
  res.json({ balances: await bridgeManager.getBalances(), wallet: WALLET_ADDRESS });
});

router.get('/gas', requireRunning, async (req, res) => {
  res.json({ gasPrices: await bridgeManager.getGasPrices() });
});

router.get('/recommendations', requireRunning, async (req, res) => {
  res.json({ recommendations: await bridgeManager.getRecommendations() });
});

router.get('/routes', (req, res) => {
  const { from, to, token, amount } = req.query;
  
  // Validate required parameters
  if (!from || !to || !token || !amount) {
    return res.status(400).json({ error: 'Missing params: from, to, token, amount required' });
  }
  
  // Validate chain IDs
  if (!VALID_CHAINS.includes(from as ChainId) || !VALID_CHAINS.includes(to as ChainId)) {
    return res.status(400).json({ error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(', ')}` });
  }
  
  // Validate token
  if (token !== 'USDT' && token !== 'USDC') {
    return res.status(400).json({ error: 'Invalid token. Must be USDT or USDC' });
  }
  
  // Validate amount
  const amountNum = parseFloat(amount as string);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount. Must be a positive number' });
  }
  
  res.json({ routes: bridgeManager.getBridgeRoutes(from as ChainId, to as ChainId, token as 'USDT' | 'USDC', amountNum) });
});

router.get('/deposit/:chain', (req, res) => {
  const chain = req.params.chain as ChainId;
  
  // Validate chain ID
  if (!VALID_CHAINS.includes(chain)) {
    return res.status(400).json({ error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(', ')}` });
  }
  
  res.json(withdrawDepositManager.getDepositInfo(chain));
});

router.get('/deposit', (req, res) => {
  res.json({ addresses: withdrawDepositManager.getAllDepositAddresses() });
});

router.post('/withdraw', requireRunning, async (req, res) => {
  const { chain, token, amount, toAddress } = req.body;
  
  // Validate required parameters
  if (!chain || !token || !amount || !toAddress) {
    return res.status(400).json({ error: 'Missing params: chain, token, amount, toAddress required' });
  }
  
  // Validate chain ID
  if (!VALID_CHAINS.includes(chain as ChainId)) {
    return res.status(400).json({ error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(', ')}` });
  }
  
  // Validate token
  if (!VALID_TOKENS.includes(token)) {
    return res.status(400).json({ error: `Invalid token. Must be one of: ${VALID_TOKENS.join(', ')}` });
  }
  
  // Validate amount
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount. Must be a positive number' });
  }
  
  // Validate Ethereum address (basic check)
  if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    return res.status(400).json({ error: 'Invalid Ethereum address format' });
  }
  
  const result = await withdrawDepositManager.withdraw({ chain, token, amount: amountNum, toAddress });
  res.status(result.success ? 200 : 400).json(result);
});

router.get('/withdraw/estimate', async (req, res) => {
  const { chain, token } = req.query;
  
  // Validate required parameters
  if (!chain || !token) {
    return res.status(400).json({ error: 'Missing params: chain, token required' });
  }
  
  // Validate chain ID
  if (!VALID_CHAINS.includes(chain as ChainId)) {
    return res.status(400).json({ error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(', ')}` });
  }
  
  // Validate token
  if (!VALID_TOKENS.includes(token as string)) {
    return res.status(400).json({ error: `Invalid token. Must be one of: ${VALID_TOKENS.join(', ')}` });
  }
  
  res.json(await withdrawDepositManager.estimateWithdrawGas(chain as ChainId, token as 'native' | 'USDT' | 'USDC'));
});

export { router as bridgeApi };
