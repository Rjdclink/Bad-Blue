import assert from 'node:assert/strict';
import {
  InMemoryNativeGasFundingAttemptStore,
  NativeGasFundingCoordinator,
  NativeGasFundingSubmissionUnknownError,
  type NativeGasFundingRequest,
  type NativeGasFundingStrategy,
} from '../execution/native-gas-funding-coordinator.js';

const evidence = {
  scope: 'coordinator-test',
  sourceChain: 'europa',
  sourceTransactionHash: `0x${'1'.repeat(64)}`,
  profitToken: `0x${'2'.repeat(40)}`,
  realizedProfitBaseUnits: '1000000',
  recipient: `0x${'3'.repeat(40)}`,
  sourceReceiptVerified: true,
  sourceBalanceEvidenceVerified: true,
  zeroMonetaryGasVerified: true,
  zeroExternalCapitalVerified: true,
};

function request(idempotencyKey: string): NativeGasFundingRequest {
  return {
    idempotencyKey,
    evidence,
    destinationChain: 'polygon',
    destinationWallet: `0x${'4'.repeat(40)}`,
    requiredNativeWei: '100',
  };
}

function nonEuropaRequest(idempotencyKey: string): NativeGasFundingRequest {
  return {
    ...request(idempotencyKey),
    evidence: { ...evidence, sourceChain: 'polygon' },
  };
}

const unavailable: NativeGasFundingStrategy = {
  name: 'bridge_refuel',
  async quote() {
    return {
      strategy: 'bridge_refuel',
      available: false,
      economicallyViable: false,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: '0',
      estimatedDeliveredNativeWei: '0',
      reimbursementRequired: true,
      reason: 'No deployed bridge/refuel adapter configured',
    };
  },
  async settle() {
    throw new Error('unavailable strategy must not settle');
  },
};

const successfulReserve: NativeGasFundingStrategy = {
  name: 'internal_native_reserve',
  async quote() {
    return {
      strategy: 'internal_native_reserve',
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: '10',
      estimatedDeliveredNativeWei: '100',
      reimbursementRequired: false,
      reason: 'Test reserve is available',
    };
  },
  async settle(input) {
    return {
      strategy: 'internal_native_reserve',
      state: 'SETTLED',
      sourceTransactionHash: input.evidence.sourceTransactionHash,
      destinationTransactionHash: `0x${'5'.repeat(64)}`,
      destinationReceiptVerified: true,
      destinationNativeBalanceBeforeWei: '0',
      destinationNativeBalanceAfterWei: '100',
      deliveredNativeWei: '100',
      reimbursementRequired: false,
      reimbursementVerified: true,
      sourceProceedsAllocatedBaseUnits: '0',
      provenance: ['test_destination_receipt', 'test_native_balance_delta'],
    };
  },
};

const failedRelay: NativeGasFundingStrategy = {
  name: 'bridge_refuel',
  async quote() {
    return {
      strategy: 'bridge_refuel',
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: '1',
      estimatedNetProceedsBaseUnits: '1',
      estimatedCostNativeWei: '1',
      estimatedDeliveredNativeWei: '100',
      reimbursementRequired: true,
      reason: 'Test relay is available',
    };
  },
  async settle() {
    throw new Error('Test relay failed before submission');
  },
};

const invalidEconomics: NativeGasFundingStrategy = {
  name: 'bridge_refuel',
  async quote() {
    return {
      strategy: 'bridge_refuel',
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: '1',
      estimatedDeliveredNativeWei: '100',
      reimbursementRequired: true,
      reason: 'Test relay has no positive net economics',
    };
  },
  async settle() {
    throw new Error('Economically invalid strategy must not settle');
  },
};

const unknownSubmission: NativeGasFundingStrategy = {
  name: 'bridge_refuel',
  async quote() {
    return {
      strategy: 'bridge_refuel',
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: '1',
      estimatedNetProceedsBaseUnits: '1',
      estimatedCostNativeWei: '1',
      estimatedDeliveredNativeWei: '100',
      reimbursementRequired: true,
      reason: 'Test relay submission is ambiguous',
    };
  },
  async settle() {
    throw new NativeGasFundingSubmissionUnknownError('receipt lookup timed out', `0x${'6'.repeat(64)}`);
  },
};

async function main(): Promise<void> {
  const store = new InMemoryNativeGasFundingAttemptStore();
  const coordinator = new NativeGasFundingCoordinator([unavailable, successfulReserve], store);
  const settled = await coordinator.settleVerifiedProfit(nonEuropaRequest('funding-1'));
  assert.equal(settled.state, 'SETTLED');
  assert.equal(settled.destinationReceiptVerified, true);
  assert.equal(settled.deliveredNativeWei, '100');

  const replayed = await coordinator.settleVerifiedProfit(nonEuropaRequest('funding-1'));
  assert.equal(replayed.state, 'SETTLED');
  assert.equal(replayed.destinationTransactionHash, settled.destinationTransactionHash);

  const europaReserveResult = await new NativeGasFundingCoordinator(
    [successfulReserve],
    new InMemoryNativeGasFundingAttemptStore(),
  ).settleVerifiedProfit(request('funding-europa-reserve'));
  assert.equal(europaReserveResult.state, 'FAILED');
  assert.match(europaReserveResult.error || '', /internal_native_reserve/);

  const unavailableResult = await new NativeGasFundingCoordinator(
    [unavailable],
    new InMemoryNativeGasFundingAttemptStore(),
  ).settleVerifiedProfit(request('funding-2'));
  assert.equal(unavailableResult.state, 'FAILED');
  assert.match(unavailableResult.error || '', /bridge_refuel/);

  const fallbackResult = await new NativeGasFundingCoordinator(
    [failedRelay, successfulReserve],
    new InMemoryNativeGasFundingAttemptStore(),
  ).settleVerifiedProfit(request('funding-fallback'));
  assert.equal(fallbackResult.state, 'SETTLED');
  assert.equal(fallbackResult.strategy, 'internal_native_reserve');

  const invalidEconomicsResult = await new NativeGasFundingCoordinator(
    [invalidEconomics],
    new InMemoryNativeGasFundingAttemptStore(),
  ).settleVerifiedProfit(request('funding-invalid-economics'));
  assert.equal(invalidEconomicsResult.state, 'FAILED');
  assert.match(invalidEconomicsResult.error || '', /positive net economics|No native-gas funding strategy/);

  const unknownSubmissionResult = await new NativeGasFundingCoordinator(
    [unknownSubmission, successfulReserve],
    new InMemoryNativeGasFundingAttemptStore(),
  ).settleVerifiedProfit(request('funding-unknown-submission'));
  assert.equal(unknownSubmissionResult.state, 'SUBMITTED');
  assert.equal(unknownSubmissionResult.destinationTransactionHash, `0x${'6'.repeat(64)}`);

  await assert.rejects(
    () => coordinator.settleVerifiedProfit({
      ...request('funding-invalid'),
      evidence: { ...evidence, sourceReceiptVerified: false },
    }),
    /receipt-backed zero-capital realized-profit evidence/,
  );

  console.log(JSON.stringify({
    settled: settled.state,
    replayed: replayed.state,
    unavailable: unavailableResult.state,
    fallback: fallbackResult.state,
    unknownSubmission: unknownSubmissionResult.state,
    proofGate: 'rejected_unverified_profit',
  }));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});