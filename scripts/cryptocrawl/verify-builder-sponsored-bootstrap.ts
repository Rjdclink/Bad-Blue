import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber } from 'ethers';
import { compileReceiverContract } from './compile-flashloan-receiver.js';
import {
  buildBuilderSponsoredBundleGasPlan,
  buildBuilderSponsoredGasPlan,
  computeNextBlockBaseFee,
  requireBuilderPaymentCovered,
} from '../../server/services/cryptocrawl/execution/builder-sponsored-bundle-policy.js';

const SOURCE = 'contracts/cryptocrawl/CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver.sol';
const CONTRACT = 'CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver';

async function main(): Promise<void> {
  const base = BigNumber.from(100);
  const blockGasLimit = BigNumber.from(30_000_000);
  assert.equal(computeNextBlockBaseFee({ baseFeePerGasWei: base, gasUsed: 15_000_000, gasLimit: blockGasLimit }).toString(), '100');
  assert.equal(computeNextBlockBaseFee({ baseFeePerGasWei: base, gasUsed: 30_000_000, gasLimit: blockGasLimit }).toString(), '112');
  assert.equal(computeNextBlockBaseFee({ baseFeePerGasWei: base, gasUsed: 0, gasLimit: blockGasLimit }).toString(), '88');

  const plan = buildBuilderSponsoredGasPlan({
    currentBlockNumber: 25_000_000,
    baseFeePerGasWei: base,
    blockGasUsed: 30_000_000,
    blockGasLimit,
    transactionGasLimit: 100_000,
    builderMarginBps: 1_000,
  });
  assert.equal(plan.targetBlock, 25_000_001);
  assert.equal(plan.nextBaseFeePerGasWei.toString(), '112');
  assert.equal(plan.maxFeePerGasWei.toString(), '113');
  assert.equal(plan.maxPriorityFeePerGasWei.toString(), '0');
  assert.equal(plan.sponsorCapWei.toString(), '11300000');
  assert.equal(plan.builderMarginWei.toString(), '1130000');
  assert.equal(plan.builderPaymentWei.toString(), '12430000');

  const greenfield = buildBuilderSponsoredBundleGasPlan({
    currentBlockNumber: 25_000_000,
    baseFeePerGasWei: base,
    blockGasUsed: 30_000_000,
    blockGasLimit,
    transactions: [
      { gasLimit: 1_000_000 }, // deterministic receiver deployment
      { gasLimit: 100_000 }, // permissions
      { gasLimit: 500_000 }, // flash route + builder repayment
    ],
    builderMarginBps: 1_000,
  });
  assert.equal(greenfield.transactionCount, 3);
  assert.equal(greenfield.totalGasLimit.toString(), '1600000');
  assert.equal(greenfield.totalValueWei.toString(), '0');
  assert.equal(greenfield.sponsorCapWei.toString(), '180800000');
  assert.equal(greenfield.builderMarginWei.toString(), '18080000');
  assert.equal(greenfield.builderPaymentWei.toString(), '198880000');

  requireBuilderPaymentCovered({ builderPaymentWei: plan.builderPaymentWei, exactOutputWethWei: plan.builderPaymentWei });
  assert.throws(
    () => requireBuilderPaymentCovered({ builderPaymentWei: plan.builderPaymentWei, exactOutputWethWei: plan.builderPaymentWei.sub(1) }),
    /below the hard builder-payment requirement/,
  );

  const source = await readFile(resolve(process.cwd(), SOURCE), 'utf8');
  assert.match(source, /block\.coinbase/);
  assert.match(source, /builderPaymentWei/);
  assert.match(source, /amountOwed \+ minResidualProfit/);
  assert.match(source, /builder_weth_budget_missing/);
  assert.match(source, /terminal_residual_below_threshold/);

  const artifact = await compileReceiverContract(SOURCE, CONTRACT, { viaIR: true });
  assert.equal(artifact.contractName, CONTRACT);
  assert.ok(artifact.bytecode.startsWith('0x') && artifact.bytecode.length > 100);
  const functions = artifact.abi
    .filter((entry: any) => entry?.type === 'function')
    .map((entry: any) => entry?.name);
  assert.ok(functions.includes('executeBuilderSponsoredBalancerFlashLoan'));
  assert.ok(functions.includes('receiveFlashLoan'));

  console.log('[verify-builder-sponsored-bootstrap] PASS');
  console.log(JSON.stringify({
    targetBlock: plan.targetBlock,
    nextBaseFeePerGasWei: plan.nextBaseFeePerGasWei.toString(),
    singleTransactionSponsorCapWei: plan.sponsorCapWei.toString(),
    greenfieldBundleSponsorCapWei: greenfield.sponsorCapWei.toString(),
    greenfieldBundleBuilderPaymentWei: greenfield.builderPaymentWei.toString(),
    contract: CONTRACT,
    compiler: artifact.compiler,
    publicMempoolFallback: false,
  }, null, 2));
}

main().catch(error => {
  console.error('[verify-builder-sponsored-bootstrap] FAIL:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
