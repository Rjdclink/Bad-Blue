import { BigNumber, ethers } from 'ethers';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId } from '../bridge/types.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getSponsoredReceiverManager } from './adapters/sponsored-receiver-manager.js';
import { creditVerifiedReceiverProfit } from './onchain-system-capital-ledger.js';

const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);
const TRANSFER_EVENT = new ethers.utils.Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Creates system-owned on-chain capital only when one confirmed receipt proves:
 *  1) the reviewed receiver emitted an exact positive profit amount, and
 *  2) the loan token emitted Transfer(receiver -> canonical execution wallet)
 *     for that exact amount.
 * Generic wallet balance never creates ownership.
 */
export async function recordAtomicReceiverProfitAsSystemCapital(input: {
  opportunityId: string;
  chain: ChainId;
  transactionHash: string;
}): Promise<{ recorded: boolean; amountBaseUnits: string | null }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) return { recorded: false, amountBaseUnits: null };
  const config = SUPPORTED_CHAINS[input.chain];
  if (!config?.usdc) return { recorded: false, amountBaseUnits: null };
  const manager = getSponsoredReceiverManager();
  const receiver = manager.getReceiver(input.chain as any);
  if (!receiver) return { recorded: false, amountBaseUnits: null };
  const recipient = resolveOperationalProfitRecipient();

  await multiProviderRpcManager.initialize([input.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.chain, 'json_rpc');
  const receipt = await provider.getTransactionReceipt(input.transactionHash);
  if (!receipt || receipt.status !== 1) return { recorded: false, amountBaseUnits: null };

  let profit: BigNumber | null = null;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, receiver)) continue;
    try {
      const parsed = RECEIVER_EVENT.parseLog(log);
      if (parsed.name !== 'FlashLoanExecuted') continue;
      if (!sameAddress(String(parsed.args.loanToken), config.usdc)) return { recorded: false, amountBaseUnits: null };
      const observed = BigNumber.from(parsed.args.profit);
      if (observed.lte(0)) return { recorded: false, amountBaseUnits: null };
      if (profit && !profit.eq(observed)) return { recorded: false, amountBaseUnits: null };
      profit = observed;
    } catch { /* unrelated receiver log */ }
  }
  if (!profit) return { recorded: false, amountBaseUnits: null };

  let exactTransfer = false;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, config.usdc)) continue;
    try {
      const parsed = TRANSFER_EVENT.parseLog(log);
      if (parsed.name !== 'Transfer') continue;
      if (
        sameAddress(String(parsed.args.from), receiver)
        && sameAddress(String(parsed.args.to), recipient)
        && BigNumber.from(parsed.args.value).eq(profit)
      ) {
        exactTransfer = true;
        break;
      }
    } catch { /* unrelated token log */ }
  }
  if (!exactTransfer) return { recorded: false, amountBaseUnits: null };

  await creditVerifiedReceiverProfit({
    opportunityId: input.opportunityId,
    chain: input.chain,
    asset: 'USDC',
    tokenAddress: config.usdc,
    decimals: 6,
    amountBaseUnits: profit.toString(),
    transactionHash: input.transactionHash,
    receiver,
    recipient,
    provenance: [
      'terminal_receipt:status_1',
      'receiver:FlashLoanExecuted_exact_profit',
      'erc20:Transfer_receiver_to_canonical_execution_wallet_exact_profit',
      'flash_loan_repayment_precedes_profit_transfer:receiver_contract',
      'wallet_balance_authority:false',
      'synthetic_evidence:false',
    ],
  });
  return { recorded: true, amountBaseUnits: profit.toString() };
}
