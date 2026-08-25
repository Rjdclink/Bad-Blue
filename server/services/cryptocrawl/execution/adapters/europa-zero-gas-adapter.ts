import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import type { BuiltOnchainPayload } from './onchain-payload-builder.js';
import { EUROPA_NETWORK, EuropaRpcPool, type EuropaRpcHealth } from './europa-network.js';
import type { Stage4ExecutionLedger } from './stage4-execution-ledger.js';
import { SkaleExternalGasPowAdapter, type SkaleExternalGasPowSolution } from './skale-pow-adapter.js';
import { Stage4PowComputeCoordinator, type Stage4ComputeSource } from './stage4-pow-compute-coordinator.js';

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const RECEIVER_ABI = [
  'function vault() view returns (address)',
  'function factory() view returns (address)',
  'event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit)',
];

export interface EuropaAtomicExecutionRequest {
  opportunityId: string;
  receiver: string;
  receiverCodeHash: string;
  balancerVault: string;
  receiverKind?: 'balancer' | 'sushi-v3';
  sushiV3Factory?: string;
  inputToken: string;
  profitRecipient?: string;
  maxExternalProfitRecipientBalance?: string;
  payload: BuiltOnchainPayload;
  maxExternalNativeBalanceWei?: string;
  maxExternalInputBalance?: string;
  confirmationTimeoutMs?: number;
  externalGasPow?: {
    difficulty: bigint;
    maxAttempts: number;
    workerCount?: number;
  };
}

export interface EuropaExecutionProof {
  executionKey: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  receiptStatus?: 0 | 1;
  startingNativeBalanceWei?: bigint;
  endingNativeBalanceWei?: bigint;
  nativeFeeWei?: bigint;
  startingInputBalance?: bigint;
  endingInputBalance?: bigint;
  profitRecipient?: string;
  profitRecipientStartingInputBalance?: bigint;
  profitRecipientEndingInputBalance?: bigint;
  realizedProfit?: bigint;
  pow?: SkaleExternalGasPowSolution;
  computeSource?: Stage4ComputeSource;
  zeroMonetaryGasVerified: boolean;
  success: boolean;
  duplicate?: boolean;
  error?: string;
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function requireHash(label: string, value: string): string {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte keccak256 hash`);
  return value.toLowerCase();
}

function parseNonNegativeInteger(label: string, value: string | undefined, fallback: string): BigNumber {
  const normalized = (value || fallback).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a non-negative integer string`);
  return BigNumber.from(normalized);
}

export function buildEuropaExecutionFingerprint(input: {
  signer: string;
  nonce: number;
  payload: BuiltOnchainPayload;
  gasPriceWei: string;
}): string {
  const canonical = JSON.stringify({
    chainId: EUROPA_NETWORK.chainId,
    signer: input.signer.toLowerCase(),
    nonce: input.nonce,
    to: input.payload.to.toLowerCase(),
    dataHash: ethers.utils.keccak256(input.payload.data),
    value: input.payload.value,
    gasLimit: input.payload.gasLimit,
    gasPriceWei: input.gasPriceWei,
  });
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(canonical));
}

export function calculateEuropaNativeFee(startingBalance: BigNumber, endingBalance: BigNumber): BigNumber {
  return startingBalance.gt(endingBalance) ? startingBalance.sub(endingBalance) : BigNumber.from(0);
}

export class EuropaZeroGasAdapter {
  constructor(
    private readonly signer: Wallet,
    private readonly ledger: Stage4ExecutionLedger,
    private readonly rpcPool: EuropaRpcPool = new EuropaRpcPool(),
  ) {}

  async checkReadiness(): Promise<EuropaRpcHealth[]> {
    const health = await this.rpcPool.healthCheck();
    if (!health.some(check => check.healthy)) throw new Error('Europa has no healthy RPC endpoint');
    return health;
  }

  async execute(request: EuropaAtomicExecutionRequest): Promise<EuropaExecutionProof> {
    const receiver = requireAddress('Europa receiver', request.receiver);
    const inputToken = requireAddress('Europa input token', request.inputToken);
    const expectedVault = request.receiverKind === 'sushi-v3'
      ? undefined
      : requireAddress('Europa Balancer vault', request.balancerVault);
    const expectedFactory = request.receiverKind === 'sushi-v3'
      ? requireAddress('Europa Sushi V3 factory', request.sushiV3Factory || '')
      : undefined;
    const expectedCodeHash = requireHash('Europa receiver code hash', request.receiverCodeHash);
    if (request.payload.to.toLowerCase() !== receiver.toLowerCase()) {
      throw new Error('Europa payload target must be the verified atomic receiver');
    }

    const { provider } = await this.rpcPool.getHealthyProvider();
    const signer = this.signer.connect(provider);
    const signerAddress = await signer.getAddress();
    const profitRecipient = requireAddress('Europa profit recipient', request.profitRecipient || signerAddress);
    const maxExternalNativeBalance = parseNonNegativeInteger('maxExternalNativeBalanceWei', request.maxExternalNativeBalanceWei, '0');
    const startingNativeBalance = await provider.getBalance(signerAddress);
    if (startingNativeBalance.gt(maxExternalNativeBalance)) {
      throw new Error(`Europa executor has ${startingNativeBalance.toString()} native wei; zero-external-capital bootstrap requires at most ${maxExternalNativeBalance.toString()}`);
    }

    const code = await provider.getCode(receiver);
    if (code === '0x') throw new Error('Europa receiver has no deployed bytecode');
    const actualCodeHash = ethers.utils.keccak256(code).toLowerCase();
    if (actualCodeHash !== expectedCodeHash) {
      throw new Error(`Europa receiver bytecode hash mismatch: expected ${expectedCodeHash}, received ${actualCodeHash}`);
    }
    const receiverContract = new Contract(receiver, RECEIVER_ABI, provider);
    if (request.receiverKind === 'sushi-v3') {
      const configuredFactory = requireAddress('Europa receiver factory', await receiverContract.factory());
      if (configuredFactory.toLowerCase() !== expectedFactory!.toLowerCase()) {
        throw new Error(`Europa receiver factory mismatch: expected ${expectedFactory}, received ${configuredFactory}`);
      }
    } else {
      const configuredVault = requireAddress('Europa receiver vault', await receiverContract.vault());
      if (configuredVault.toLowerCase() !== expectedVault!.toLowerCase()) {
        throw new Error(`Europa receiver vault mismatch: expected ${expectedVault}, received ${configuredVault}`);
      }
    }

    const inputTokenContract = new Contract(inputToken, ERC20_ABI, provider);
    const startingInputBalance = BigNumber.from(await inputTokenContract.balanceOf(signerAddress));
    const startingProfitRecipientInputBalance = BigNumber.from(await inputTokenContract.balanceOf(profitRecipient));
    const maxExternalProfitRecipientBalance = parseNonNegativeInteger(
      'maxExternalProfitRecipientBalance',
      request.maxExternalProfitRecipientBalance,
      '0',
    );
    if (profitRecipient.toLowerCase() !== signerAddress.toLowerCase() && startingProfitRecipientInputBalance.gt(maxExternalProfitRecipientBalance)) {
      throw new Error(`Europa profit recipient has ${startingProfitRecipientInputBalance.toString()} input-token units; bootstrap recipient balance exceeds the configured external-capital bound`);
    }
    const maxExternalInputBalance = parseNonNegativeInteger('maxExternalInputBalance', request.maxExternalInputBalance, '0');
    if (startingInputBalance.gt(maxExternalInputBalance)) {
      throw new Error(`Europa executor has ${startingInputBalance.toString()} input-token units; bootstrap requires at most ${maxExternalInputBalance.toString()} externally supplied execution capital`);
    }
    const nonce = await provider.getTransactionCount(signerAddress, 'pending');
    let gasPrice = await provider.getGasPrice();
    const estimatedGas = await provider.estimateGas({
      from: signerAddress,
      to: receiver,
      data: request.payload.data,
      value: BigNumber.from(request.payload.value),
    });
    const gasLimit = BigNumber.from(request.payload.gasLimit);
    if (estimatedGas.gt(gasLimit)) {
      throw new Error(`Europa receiver estimate ${estimatedGas.toString()} exceeds bounded gas limit ${gasLimit.toString()}`);
    }

    let pow: SkaleExternalGasPowSolution | undefined;
    let computeSource: Stage4ComputeSource | undefined;
    if (request.externalGasPow) {
      const powAdapter = new SkaleExternalGasPowAdapter(provider);
      const powRequest = {
        workloadId: `${request.opportunityId}:${receiver}`,
        sender: signerAddress,
        nonce,
        payload: request.payload,
        requiredGas: BigInt(estimatedGas.toString()),
        externalGasDifficulty: request.externalGasPow.difficulty,
        maxAttempts: request.externalGasPow.maxAttempts,
      };
      const compute = new Stage4PowComputeCoordinator(provider);
      const beamResult = await compute.findProof(powRequest, {
        workerCount: request.externalGasPow.workerCount,
        timeoutMs: Math.max(10_000, request.confirmationTimeoutMs || 90_000),
      });
      pow = beamResult.solution;
      computeSource = beamResult.source;
      if (!await powAdapter.verifyProof(powRequest, pow)) {
        throw new Error('SKALE external-gas PoW candidate failed independent RPC validation');
      }
      gasPrice = BigNumber.from(pow.gasPriceWei);
    }

    const stateFingerprint = buildEuropaExecutionFingerprint({
      signer: signerAddress,
      nonce,
      payload: request.payload,
      gasPriceWei: gasPrice.toString(),
    });
    const executionKey = `europa:${request.opportunityId}:${stateFingerprint}`;
    const reservation = await this.ledger.reserve({
      executionKey,
      opportunityId: request.opportunityId,
      chain: 'europa',
      state: 'PREPARED',
      stateFingerprint,
      receiver,
      startingNativeBalanceWei: startingNativeBalance.toString(),
      startingInputBalance: startingInputBalance.toString(),
    });
    if (!reservation.created) {
      return {
        executionKey,
        transactionHash: reservation.record.transactionHash,
        zeroMonetaryGasVerified: reservation.record.nativeFeeWei === '0',
        success: false,
        duplicate: true,
        error: `Execution already reserved in state ${reservation.record.state}; no duplicate transaction will be submitted`,
      };
    }

    const signedTransaction = await signer.signTransaction({
      chainId: EUROPA_NETWORK.chainId,
      nonce,
      to: receiver,
      data: request.payload.data,
      value: BigNumber.from(request.payload.value),
      gasLimit,
      gasPrice,
    });
    const transactionHash = ethers.utils.keccak256(signedTransaction);
    await this.ledger.markSubmitted(executionKey, transactionHash, nonce);

    try {
      await this.rpcPool.broadcastSignedTransaction(signedTransaction);
    } catch (error) {
      const observed = await this.rpcPool.getTransaction(transactionHash);
      if (!observed) {
        return {
          executionKey,
          transactionHash,
          zeroMonetaryGasVerified: false,
          success: false,
          error: `Europa broadcast outcome is unknown; ledger remains submitted and retries are blocked: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    let receipt: providers.TransactionReceipt;
    try {
      receipt = await this.rpcPool.waitForReceipt(transactionHash, request.confirmationTimeoutMs || 90_000);
    } catch (error) {
      return {
        executionKey,
        transactionHash,
        zeroMonetaryGasVerified: false,
        success: false,
        error: `Europa receipt is pending; retries are blocked until chain status is resolved: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (receipt.status !== 1) {
      await this.ledger.markFailed(executionKey, 'Europa transaction reverted');
      return {
        executionKey,
        transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: BigInt(receipt.gasUsed.toString()),
        receiptStatus: 0,
        zeroMonetaryGasVerified: false,
        success: false,
        error: 'Europa transaction reverted',
      };
    }

    const endingNativeBalance = await provider.getBalance(signerAddress);
    const endingInputBalance = BigNumber.from(await inputTokenContract.balanceOf(signerAddress));
    const endingProfitRecipientInputBalance = BigNumber.from(await inputTokenContract.balanceOf(profitRecipient));
    const measuredNativeFee = calculateEuropaNativeFee(startingNativeBalance, endingNativeBalance);
    const realizedProfit = endingProfitRecipientInputBalance.gt(startingProfitRecipientInputBalance)
      ? endingProfitRecipientInputBalance.sub(startingProfitRecipientInputBalance)
      : BigNumber.from(0);
    const receiverEvent = receipt.logs.find(log => log.address.toLowerCase() === receiver.toLowerCase() && log.topics[0] === receiverContract.interface.getEventTopic('FlashLoanExecuted'));
    const emittedProfit = receiverEvent
      ? BigNumber.from(receiverContract.interface.parseLog(receiverEvent).args.profit)
      : BigNumber.from(0);

    await this.ledger.markConfirmed(executionKey, {
      endingNativeBalanceWei: endingNativeBalance.toString(),
      nativeFeeWei: measuredNativeFee.toString(),
      endingInputBalance: endingInputBalance.toString(),
      realizedProfit: realizedProfit.toString(),
      receiptBlock: receipt.blockNumber,
    });

    if (measuredNativeFee.gt(maxExternalNativeBalance)) {
      return {
        executionKey,
        transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: BigInt(receipt.gasUsed.toString()),
        receiptStatus: 1,
        startingNativeBalanceWei: BigInt(startingNativeBalance.toString()),
        endingNativeBalanceWei: BigInt(endingNativeBalance.toString()),
        nativeFeeWei: BigInt(measuredNativeFee.toString()),
        startingInputBalance: BigInt(startingInputBalance.toString()),
        endingInputBalance: BigInt(endingInputBalance.toString()),
        profitRecipient,
        profitRecipientStartingInputBalance: BigInt(startingProfitRecipientInputBalance.toString()),
        profitRecipientEndingInputBalance: BigInt(endingProfitRecipientInputBalance.toString()),
        realizedProfit: BigInt(realizedProfit.toString()),
        pow,
        computeSource,
        zeroMonetaryGasVerified: false,
        success: false,
        error: `Europa receipt consumed ${measuredNativeFee.toString()} native wei; zero-monetary-gas proof failed`,
      };
    }
    if (realizedProfit.lte(0) || emittedProfit.lte(0) || !realizedProfit.eq(emittedProfit)) {
      return {
        executionKey,
        transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: BigInt(receipt.gasUsed.toString()),
        receiptStatus: 1,
        startingNativeBalanceWei: BigInt(startingNativeBalance.toString()),
        endingNativeBalanceWei: BigInt(endingNativeBalance.toString()),
        nativeFeeWei: BigInt(measuredNativeFee.toString()),
        startingInputBalance: BigInt(startingInputBalance.toString()),
        endingInputBalance: BigInt(endingInputBalance.toString()),
        profitRecipient,
        profitRecipientStartingInputBalance: BigInt(startingProfitRecipientInputBalance.toString()),
        profitRecipientEndingInputBalance: BigInt(endingProfitRecipientInputBalance.toString()),
        realizedProfit: BigInt(realizedProfit.toString()),
        pow,
        computeSource,
        zeroMonetaryGasVerified: true,
        success: false,
        error: 'Europa transaction succeeded but did not prove a positive atomic profit; emitted profit did not equal the verified profit-recipient balance delta',
      };
    }

    return {
      executionKey,
      transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: BigInt(receipt.gasUsed.toString()),
      receiptStatus: 1,
      startingNativeBalanceWei: BigInt(startingNativeBalance.toString()),
      endingNativeBalanceWei: BigInt(endingNativeBalance.toString()),
      nativeFeeWei: BigInt(measuredNativeFee.toString()),
      startingInputBalance: BigInt(startingInputBalance.toString()),
      endingInputBalance: BigInt(endingInputBalance.toString()),
      profitRecipient,
      profitRecipientStartingInputBalance: BigInt(startingProfitRecipientInputBalance.toString()),
      profitRecipientEndingInputBalance: BigInt(endingProfitRecipientInputBalance.toString()),
      realizedProfit: BigInt(realizedProfit.toString()),
      pow,
      computeSource,
      zeroMonetaryGasVerified: true,
      success: true,
    };
  }
}