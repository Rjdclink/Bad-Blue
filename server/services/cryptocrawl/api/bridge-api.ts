import express from 'express';
import { bridgeManager } from '../bridge/bridge-manager';
import { withdrawDepositManager } from '../bridge/withdraw-deposit';
import { routeOptimizer } from '../bridge/route-optimizer';
import { ChainId } from '../bridge/types';

const router = express.Router();

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

router.get('/balances', async (req, res) => {
  if (!bridgeManager.isRunning()) return res.status(503).json({ error: 'System not running' });
  res.json({ balances: await bridgeManager.getBalances(), wallet: '0x3d9bf00bB691793Cd256563fd14819B395306f62' });
});

router.get('/gas', async (req, res) => {
  if (!bridgeManager.isRunning()) return res.status(503).json({ error: 'System not running' });
  res.json({ gasPrices: await bridgeManager.getGasPrices() });
});

router.get('/recommendations', async (req, res) => {
  if (!bridgeManager.isRunning()) return res.status(503).json({ error: 'System not running' });
  res.json({ recommendations: await bridgeManager.getRecommendations() });
});

router.get('/routes', (req, res) => {
  const { from, to, token, amount } = req.query;
  if (!from || !to || !token || !amount) return res.status(400).json({ error: 'Missing params' });
  res.json({ routes: bridgeManager.getBridgeRoutes(from as ChainId, to as ChainId, token as 'USDT' | 'USDC', parseFloat(amount as string)) });
});

router.get('/deposit/:chain', (req, res) => {
  const chain = req.params.chain as ChainId;
  res.json(withdrawDepositManager.getDepositInfo(chain));
});

router.get('/deposit', (req, res) => {
  res.json({ addresses: withdrawDepositManager.getAllDepositAddresses() });
});

router.post('/withdraw', async (req, res) => {
  if (!bridgeManager.isRunning()) return res.status(503).json({ error: 'System not running' });
  const { chain, token, amount, toAddress } = req.body;
  if (!chain || !token || !amount || !toAddress) return res.status(400).json({ error: 'Missing params' });
  const result = await withdrawDepositManager.withdraw({ chain, token, amount: parseFloat(amount), toAddress });
  res.status(result.success ? 200 : 400).json(result);
});

router.get('/withdraw/estimate', async (req, res) => {
  const { chain, token } = req.query;
  if (!chain || !token) return res.status(400).json({ error: 'Missing params' });
  res.json(await withdrawDepositManager.estimateWithdrawGas(chain as ChainId, token as 'native' | 'USDT' | 'USDC'));
});

export { router as bridgeApi };
