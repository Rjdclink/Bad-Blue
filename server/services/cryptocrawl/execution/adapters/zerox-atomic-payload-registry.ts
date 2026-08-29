import type { BuiltOnchainPayload } from './onchain-payload-builder.js';
import type { FlashLoanProviderKind } from './flash-loan-provider-economics.js';

export interface ZeroXAtomicPayloadEvidence {
  opportunityId: string;
  provider: FlashLoanProviderKind;
  receiver: string;
  payload: BuiltOnchainPayload;
  expectedGrossProfitBaseUnits: string;
  expectedNetProfitBaseUnits: string;
  requiredReceiverProfitBaseUnits: string;
  estimatedGas: string;
  firstQuoteZid: string | null;
  secondQuoteZid: string | null;
  routeSources: string[];
  exactCallSimulation: true;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

function clone(value: ZeroXAtomicPayloadEvidence): ZeroXAtomicPayloadEvidence {
  return {
    ...value,
    payload: { ...value.payload },
    routeSources: [...value.routeSources],
    provenance: [...value.provenance],
  };
}

class ZeroXAtomicPayloadRegistry {
  private readonly values = new Map<string, ZeroXAtomicPayloadEvidence>();

  set(value: ZeroXAtomicPayloadEvidence): void {
    if (!value.opportunityId.trim()) throw new Error('0x atomic payload requires opportunityId');
    if (value.expiresAt <= value.observedAt) throw new Error('0x atomic payload requires a valid expiration');
    this.values.set(value.opportunityId, clone(value));
    this.prune();
  }

  get(opportunityId: string): ZeroXAtomicPayloadEvidence | null {
    const value = this.values.get(opportunityId);
    if (!value) return null;
    if (value.expiresAt <= Date.now()) {
      this.values.delete(opportunityId);
      return null;
    }
    return clone(value);
  }

  remove(opportunityId: string): void {
    this.values.delete(opportunityId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, value] of this.values) if (value.expiresAt <= now) this.values.delete(id);
    if (this.values.size <= 1024) return;
    const oldest = [...this.values.values()].sort((a, b) => a.observedAt - b.observedAt);
    for (let index = 0; index < oldest.length - 1024; index += 1) this.values.delete(oldest[index].opportunityId);
  }
}

export const zeroXAtomicPayloadRegistry = new ZeroXAtomicPayloadRegistry();
