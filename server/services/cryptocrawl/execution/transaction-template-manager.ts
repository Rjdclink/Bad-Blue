import { createHash } from 'node:crypto';
import { withEvmSignerLane } from './evm-signer-lane.js';

export interface EvmTransactionTemplate {
  templateId: string;
  chainId: number;
  contractAddress: string;
  contractVersion: string;
  methodSelector: `0x${string}`;
  staticCalldataPrefix: `0x${string}`;
  allowlistedTokens: string[];
  accessList?: Array<{ address: string; storageKeys: string[] }>;
  gasEstimateRange: { min: number; max: number };
  eip712Domain?: Record<string, string | number>;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface DynamicTransactionFields {
  walletAddress: string;
  chainId: number;
  amount: string;
  minOutput: string;
  deadline: number;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  dynamicCalldataSuffix: `0x${string}`;
  value?: string;
}

export interface FinalizedUnsignedTransaction {
  templateId: string;
  to: string;
  chainId: number;
  nonce: number;
  data: `0x${string}`;
  value: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  deadline: number;
  amount: string;
  minOutput: string;
  requiresCanonicalSignerLane: true;
  presignedStockpileAllowed: false;
}

const MAX_TEMPLATES = Math.max(16, Math.min(1024, Number(process.env.CRYPTO_TX_TEMPLATE_LIMIT || 128)));
const templates = new Map<string, EvmTransactionTemplate>();

function address(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error(`Invalid EVM address ${value}`);
  return normalized;
}
function hex(value: string, label: string): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (!/^0x(?:[a-f0-9]{2})*$/.test(normalized)) throw new Error(`${label} must be even-length hex`);
  return normalized as `0x${string}`;
}
function positiveIntegerString(value: string, label: string, allowZero = false): string {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer string`);
  const parsed = BigInt(value);
  if (allowZero ? parsed < 0n : parsed <= 0n) throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`);
  return parsed.toString();
}
function stableId(input: Omit<EvmTransactionTemplate, 'templateId'>): string {
  return `tx-template:${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32)}`;
}

export function registerTransactionTemplate(input: Omit<EvmTransactionTemplate, 'templateId'>): EvmTransactionTemplate {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('Transaction template requires positive chainId');
  const contractAddress = address(input.contractAddress);
  const selector = hex(input.methodSelector, 'methodSelector');
  if (selector.length !== 10) throw new Error('methodSelector must contain exactly 4 bytes');
  const prefix = hex(input.staticCalldataPrefix, 'staticCalldataPrefix');
  if (!Number.isFinite(input.observedAt) || !Number.isFinite(input.expiresAt) || input.expiresAt <= input.observedAt) throw new Error('Template freshness window is invalid');
  if (!Number.isFinite(input.gasEstimateRange.min) || !Number.isFinite(input.gasEstimateRange.max) || input.gasEstimateRange.min <= 0 || input.gasEstimateRange.max < input.gasEstimateRange.min) {
    throw new Error('Template gas estimate range is invalid');
  }
  const normalized: Omit<EvmTransactionTemplate, 'templateId'> = {
    ...input,
    contractAddress,
    methodSelector: selector,
    staticCalldataPrefix: prefix,
    allowlistedTokens: [...new Set(input.allowlistedTokens.map(address))],
    accessList: input.accessList?.map(item => ({ address: address(item.address), storageKeys: item.storageKeys.map(key => hex(key, 'storageKey')) })),
    provenance: [...new Set([...input.provenance, 'stable_prebuild_only', 'no_nonce_or_fee_presigning'])],
  };
  const template = { ...normalized, templateId: stableId(normalized) };
  templates.set(template.templateId, template);
  while (templates.size > MAX_TEMPLATES) templates.delete(templates.keys().next().value as string);
  return { ...template, allowlistedTokens: [...template.allowlistedTokens] };
}

export function finalizeUnsignedTransaction(templateId: string, fields: DynamicTransactionFields, now = Date.now()): FinalizedUnsignedTransaction {
  const template = templates.get(templateId);
  if (!template) throw new Error(`Unknown transaction template ${templateId}`);
  if (template.expiresAt <= now) throw new Error(`Transaction template ${templateId} is stale`);
  if (fields.chainId !== template.chainId) throw new Error(`Transaction template chain mismatch ${fields.chainId} != ${template.chainId}`);
  address(fields.walletAddress);
  if (!Number.isSafeInteger(fields.nonce) || fields.nonce < 0) throw new Error('Current nonce must be a non-negative safe integer');
  if (!Number.isSafeInteger(fields.deadline) || fields.deadline <= Math.floor(now / 1000)) throw new Error('Current execution deadline must be in the future');
  const amount = positiveIntegerString(fields.amount, 'amount');
  const minOutput = positiveIntegerString(fields.minOutput, 'minOutput', true);
  const gasLimit = positiveIntegerString(fields.gasLimit, 'gasLimit');
  const maxFeePerGas = positiveIntegerString(fields.maxFeePerGas, 'maxFeePerGas');
  const maxPriorityFeePerGas = positiveIntegerString(fields.maxPriorityFeePerGas, 'maxPriorityFeePerGas', true);
  if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) throw new Error('Priority fee cannot exceed max fee');
  const suffix = hex(fields.dynamicCalldataSuffix, 'dynamicCalldataSuffix');
  const data = `${template.methodSelector}${template.staticCalldataPrefix.slice(2)}${suffix.slice(2)}` as `0x${string}`;
  return {
    templateId,
    to: template.contractAddress,
    chainId: template.chainId,
    nonce: fields.nonce,
    data,
    value: positiveIntegerString(fields.value || '0', 'value', true),
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    deadline: fields.deadline,
    amount,
    minOutput,
    requiresCanonicalSignerLane: true,
    presignedStockpileAllowed: false,
  };
}

export async function withFinalizedTransactionSignerLane<T>(input: {
  templateId: string;
  fields: DynamicTransactionFields;
  signAndSubmit: (transaction: FinalizedUnsignedTransaction) => Promise<T>;
}): Promise<T> {
  // Finalization occurs immediately before the canonical distributed nonce lane.
  // Nothing signed is cached or stockpiled by this manager.
  const transaction = finalizeUnsignedTransaction(input.templateId, input.fields);
  return withEvmSignerLane({
    chainId: transaction.chainId,
    walletAddress: input.fields.walletAddress,
    operation: () => input.signAndSubmit(transaction),
  });
}

export function getTransactionTemplateHealth() {
  return {
    templates: templates.size,
    limit: MAX_TEMPLATES,
    precomputedFields: ['abi_selector','static_calldata_prefix','allowlisted_tokens','access_list','gas_estimate_range','eip712_domain'] as const,
    dynamicAtExecution: ['amount','min_output','deadline','nonce','gas_limit','max_fee_per_gas','max_priority_fee_per_gas','dynamic_calldata','chain_id'] as const,
    genericPresigningAllowed: false as const,
    signingAuthority: 'canonical_evm_signer_lane' as const,
    executionAuthority: false as const,
  };
}
