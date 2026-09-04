import type { AcrossBridgeQuote, AcrossSettlementEvidence } from './across-bridge-provider.js';
import { SUPPORTED_CHAINS } from './chain-config.js';

export interface AcrossTerminalAmountEvidence {
  inputAmount: string;
  outputAmount: string;
  inputToken: string;
  outputToken: string;
  originChainId: number;
  destinationChainId: number;
  depositTxnRef: string;
  authority: 'across_authenticated_deposit_details';
  settlementAuthority: false;
  provenance: string[];
}

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function validAmount(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) >= 0n;
}

/**
 * Enriches an already-confirmed Across settlement with authenticated deposited and
 * delivered amounts. It is not a second settlement authority: the caller must
 * first provide successful destination-receipt-verified settlement evidence.
 */
export async function getAcrossTerminalAmountEvidence(input: {
  quote: AcrossBridgeQuote;
  settlement: AcrossSettlementEvidence;
}): Promise<AcrossTerminalAmountEvidence | null> {
  const { quote, settlement } = input;
  if (!settlement.successful || !settlement.destinationReceiptVerified || !settlement.financiallyTerminal) return null;
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  if (!apiKey || !integratorId || !/^0x[0-9a-fA-F]{4}$/.test(integratorId)) return null;

  const params = new URLSearchParams({ depositTxnRef: settlement.depositTxnRef, integratorId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Number(process.env.ACROSS_SETTLEMENT_DETAIL_TIMEOUT_MS || 8_000)));
  try {
    const response = await fetch(`https://app.across.to/api/deposit?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { return null; }
    if (!response.ok || !payload?.deposit) return null;
    const row = payload.deposit;
    const depositTxnRef = String(row.depositTxnRef || row.depositTxHash || '');
    const originChainId = Number(row.originChainId);
    const destinationChainId = Number(row.destinationChainId);
    const inputToken = String(row.inputToken || '');
    const outputToken = String(row.outputToken || '');
    const inputAmount = row.inputAmount;
    const outputAmount = row.swapOutputTokenAmount || row.outputAmount;

    if (depositTxnRef.toLowerCase() !== settlement.depositTxnRef.toLowerCase()) return null;
    if (originChainId !== SUPPORTED_CHAINS[quote.originChain].chainId || destinationChainId !== SUPPORTED_CHAINS[quote.destinationChain].chainId) return null;
    if (!validAddress(inputToken) || inputToken.toLowerCase() !== quote.inputToken.toLowerCase()) return null;
    if (!validAddress(outputToken) || outputToken.toLowerCase() !== quote.outputToken.toLowerCase()) return null;
    if (!validAmount(inputAmount) || !validAmount(outputAmount)) return null;
    if (String(row.status || '').toLowerCase() !== 'filled') return null;

    return {
      inputAmount,
      outputAmount,
      inputToken,
      outputToken,
      originChainId,
      destinationChainId,
      depositTxnRef,
      authority: 'across_authenticated_deposit_details',
      settlementAuthority: false,
      provenance: [
        'across_deposit_details:authenticated',
        'deposit_tx_identity:verified',
        'origin_destination_chain_identity:verified',
        'input_output_token_identity:verified',
        'terminal_output_amount:authenticated',
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}
