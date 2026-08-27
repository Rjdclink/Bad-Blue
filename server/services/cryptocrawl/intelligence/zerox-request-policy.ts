export type ZeroXRequestPurpose = 'discovery' | 'execution';

export interface ZeroXRequestPolicyInput {
  purpose?: ZeroXRequestPurpose;
  takerAddress?: string;
}

export interface ZeroXRequestPolicyDecision {
  purpose: ZeroXRequestPurpose;
  endpoint: 'price' | 'quote';
  allowed: boolean;
  includeTaker: boolean;
  takerAddress: string | null;
  reason: string;
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/**
 * 0x provider-cost authority.
 *
 * Discovery is always read-only `/price`, even when a taker address is present
 * in the environment or supplied by a caller. `/quote` is reserved for an
 * explicit execution-admission request and requires a valid EVM taker address.
 */
export function resolveZeroXRequestPolicy(input: ZeroXRequestPolicyInput): ZeroXRequestPolicyDecision {
  const purpose = input.purpose === 'execution' ? 'execution' : 'discovery';
  const takerAddress = input.takerAddress?.trim() || '';
  const validTaker = EVM_ADDRESS.test(takerAddress);

  if (purpose === 'discovery') {
    return {
      purpose,
      endpoint: 'price',
      allowed: true,
      includeTaker: false,
      takerAddress: null,
      reason: validTaker
        ? 'discovery explicitly ignores configured taker; executable quote is not authorized'
        : 'discovery uses read-only price endpoint',
    };
  }

  if (!validTaker) {
    return {
      purpose,
      endpoint: 'quote',
      allowed: false,
      includeTaker: false,
      takerAddress: null,
      reason: 'execution quote requires a valid EVM taker address',
    };
  }

  return {
    purpose,
    endpoint: 'quote',
    allowed: true,
    includeTaker: true,
    takerAddress,
    reason: 'explicit execution admission authorized 0x quote request',
  };
}
