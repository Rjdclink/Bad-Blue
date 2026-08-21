import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../../server/services/cryptocrawl/execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../../server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.js';
import { buildOnchainPayloadFromPlan } from '../../server/services/cryptocrawl/execution/adapters/onchain-payload-builder.js';
import { loadConfiguredZeroCapitalRoutes } from '../../server/services/cryptocrawl/execution/adapters/onchain-route-quoter.js';

const USDC = '0x1111111111111111111111111111111111111111';
const WETH = '0x2222222222222222222222222222222222222222';
const RECEIVER = '0x3333333333333333333333333333333333333333';
const PROFIT_RECIPIENT = '0x4444444444444444444444444444444444444444';

async function main(): Promise<void> {
  const routes = loadConfiguredZeroCapitalRoutes(JSON.stringify([{
    id: 'validation-route',
    chain: 'arbitrum',
    inputAssetSymbol: 'USDC',
    inputToken: USDC,
    inputTokenDecimals: 6,
    amountIn: '1000000000',
    estimatedGasCostInInputToken: '200000',
    relayFeeInInputToken: '100000',
    flashLoanFeeBps: 0,
    minNetProfitBps: 50,
    legs: [
      { protocol: 'uniswapV3', tokenIn: USDC, tokenOut: WETH, feeTier: 500 },
      { protocol: 'sushiswap', tokenIn: WETH, tokenOut: USDC, fee: 0.003 },
    ],
  }]));
  assert.equal(routes.length, 1);

  const plan = buildFlashLoanExecutionPlanFromOpportunity({
    chain: 'arbitrum',
    inputToken: USDC,
    flashLoanAmount: 1000000000n,
    expectedProfit: 10000000n,
    route: [
      { protocol: 'uniswapV3', tokenIn: USDC, tokenOut: WETH, amountIn: 1000000000n, expectedAmountOut: 500000000000000000n, fee: 0.0005 },
      { protocol: 'sushiswap', tokenIn: WETH, tokenOut: USDC, amountIn: 500000000000000000n, expectedAmountOut: 1010000000n, fee: 0.003 },
    ],
  }, {
    receiver: RECEIVER,
    profitRecipient: PROFIT_RECIPIENT,
  });
  const flashLoanPayload = buildFlashLoanReceiverPayloadFromPlan(plan);
  assert.equal(flashLoanPayload.to, RECEIVER);
  assert.ok(flashLoanPayload.data.startsWith('0x') && flashLoanPayload.data.length > 10);

  const { ethers } = await import('ethers');
  const receiverInterface = new ethers.utils.Interface([
    'function executeBalancerFlashLoan(address loanToken, uint256 loanAmount, (address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps, uint256 minProfit, address profitRecipient) external',
  ]);
  const decodedReceiverCall = receiverInterface.decodeFunctionData('executeBalancerFlashLoan', flashLoanPayload.data);
  assert.equal(decodedReceiverCall.steps.length, 2);
  assert.equal(decodedReceiverCall.steps[0].approvalToken.toLowerCase(), USDC.toLowerCase());
  assert.equal(decodedReceiverCall.steps[1].approvalToken.toLowerCase(), WETH.toLowerCase());

  const swapPayload = buildOnchainPayloadFromPlan({
    chain: 'arbitrum',
    recipient: PROFIT_RECIPIENT,
    legs: [plan.steps[0]],
  });
  assert.ok(swapPayload.data.startsWith('0x') && swapPayload.data.length > 10);

  const source = await readFile('contracts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.sol', 'utf8');
  assert.ok(source.includes('AwaitingFlashLoan'));
  assert.ok(source.includes('unexpected_callback'));
  assert.ok(source.includes('flashloan_callback_incomplete'));
  assert.ok(source.includes('target_not_allowed'));
  assert.ok(source.includes('approval_token_not_allowed'));
  assert.ok(!source.includes('modifier nonReentrant'));

  console.log('zero-capital route planner and receiver payload validation passed');
}

main().catch(error => {
  console.error('[validate-zero-capital-layer] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});