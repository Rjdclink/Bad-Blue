import { Contract, ethers, providers } from 'ethers';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { upsertGhostWalletVenue } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';

const DOMAIN_NAME = 'CryptoCrawler Ghost Wallet Borrower Mandate';
const DOMAIN_VERSION = '1';
const ERC1271_MAGIC_VALUE = '0x1626ba7e';
const ERC1271_ABI = ['function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)'];
const OWNERSHIP_ABI = [
  'function owner() view returns (address)',
  'function getOwner() view returns (address)',
];
const BORROWER_MANDATE_TYPES = {
  BorrowerMandate: [
    { name: 'authorizer', type: 'address' },
    { name: 'borrower', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amountBaseUnits', type: 'uint256' },
    { name: 'maxBorrowerFeeBaseUnits', type: 'uint256' },
    { name: 'borrowerDataHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'maxExecutions', type: 'uint256' },
    { name: 'minIntervalSeconds', type: 'uint256' },
  ],
};
const BORROWER_RANGE_MANDATE_TYPES = {
  BorrowerRangeMandate: [
    { name: 'authorizer', type: 'address' },
    { name: 'borrower', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'minAmountBaseUnits', type: 'uint256' },
    { name: 'preferredAmountBaseUnits', type: 'uint256' },
    { name: 'maxAmountBaseUnits', type: 'uint256' },
    { name: 'maxBorrowerFeeBaseUnits', type: 'uint256' },
    { name: 'borrowerDataHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'maxExecutions', type: 'uint256' },
    { name: 'minIntervalSeconds', type: 'uint256' },
  ],
};
const CANCELLATION_TYPES = {
  BorrowerMandateCancellation: [
    { name: 'authorizer', type: 'address' },
    { name: 'mandateDigest', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export interface GhostWalletBorrowerMandateInput {
  chain: GhostWalletChain;
  borrower: string;
  asset: string;
  amountBaseUnits?: string;
  minAmountBaseUnits?: string;
  preferredAmountBaseUnits?: string;
  maxAmountBaseUnits?: string;
  maxBorrowerFeeBaseUnits: string;
  borrowerData?: string;
  authorizer: string;
  nonce: string;
  deadline: number;
  maxExecutions: number;
  minIntervalSeconds?: number;
  signature: string;
}

export interface RegisteredGhostWalletBorrowerMandate {
  mandateId: string;
  digest: string;
  chain: GhostWalletChain;
  chainId: number;
  borrower: string;
  asset: string;
  authorizer: string;
  authorizationMode: 'borrower_erc1271' | 'owner_eoa' | 'owner_erc1271';
  amountMode: 'exact' | 'range';
  amountBaseUnits: string;
  minAmountBaseUnits: string;
  preferredAmountBaseUnits: string;
  maxAmountBaseUnits: string;
  maxBorrowerFeeBaseUnits: string;
  borrowerData: string;
  nonce: string;
  deadline: number;
  maxExecutions: number;
  minIntervalSeconds: number;
}

function asAddress(value: unknown, label: string): string {
  const raw = String(value || '').trim();
  if (!ethers.utils.isAddress(raw)) throw new Error(`${label}_INVALID`);
  return ethers.utils.getAddress(raw);
}

function asUnsignedInteger(value: unknown, label: string, positive = false): bigint {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label}_INVALID`);
  const parsed = BigInt(raw);
  if (positive ? parsed <= 0n : parsed < 0n) throw new Error(`${label}_INVALID`);
  return parsed;
}

function asSafeInteger(value: unknown, label: string, positive = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) throw new Error(`${label}_INVALID`);
  return parsed;
}

function millisecondsFromSeconds(seconds: number, label: string): number {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
    throw new Error(`${label}_INVALID`);
  }
  return seconds * 1000;
}

function asData(value: unknown): string {
  const raw = String(value || '0x').trim();
  if (!ethers.utils.isHexString(raw)) throw new Error('GHOST_WALLET_MANDATE_BORROWER_DATA_INVALID');
  return raw;
}

function asSignature(value: unknown): string {
  const raw = String(value || '').trim();
  if (!ethers.utils.isHexString(raw) || raw === '0x') throw new Error('GHOST_WALLET_MANDATE_SIGNATURE_INVALID');
  return raw;
}

function amountAuthorization(input: GhostWalletBorrowerMandateInput): {
  mode: 'exact' | 'range';
  min: bigint;
  preferred: bigint;
  max: bigint;
} {
  const rangeRequested = input.minAmountBaseUnits !== undefined
    || input.preferredAmountBaseUnits !== undefined
    || input.maxAmountBaseUnits !== undefined;
  if (!rangeRequested) {
    const exact = asUnsignedInteger(input.amountBaseUnits, 'GHOST_WALLET_MANDATE_AMOUNT', true);
    return { mode: 'exact', min: exact, preferred: exact, max: exact };
  }
  if (input.minAmountBaseUnits === undefined
    || input.preferredAmountBaseUnits === undefined
    || input.maxAmountBaseUnits === undefined) {
    throw new Error('GHOST_WALLET_MANDATE_RANGE_INCOMPLETE');
  }
  const min = asUnsignedInteger(input.minAmountBaseUnits, 'GHOST_WALLET_MANDATE_MIN_AMOUNT', true);
  const preferred = asUnsignedInteger(input.preferredAmountBaseUnits, 'GHOST_WALLET_MANDATE_PREFERRED_AMOUNT', true);
  const max = asUnsignedInteger(input.maxAmountBaseUnits, 'GHOST_WALLET_MANDATE_MAX_AMOUNT', true);
  if (min > preferred || preferred > max) throw new Error('GHOST_WALLET_MANDATE_RANGE_ORDER_INVALID');
  return { mode: 'range', min, preferred, max };
}

async function contractOwner(provider: providers.Provider, borrower: string): Promise<string | null> {
  const contract = new Contract(borrower, OWNERSHIP_ABI, provider);
  for (const method of ['owner', 'getOwner'] as const) {
    try {
      const value = await contract[method]();
      const normalized = asAddress(value, 'GHOST_WALLET_MANDATE_OWNER');
      if (normalized !== ethers.constants.AddressZero) return normalized;
    } catch {
      // Ownership surfaces are alternatives. Missing one does not fail the other.
    }
  }
  return null;
}

async function verifyErc1271(input: {
  provider: providers.Provider;
  signer: string;
  digest: string;
  signature: string;
}): Promise<boolean> {
  const code = await input.provider.getCode(input.signer);
  if (code === '0x') return false;
  try {
    const contract = new Contract(input.signer, ERC1271_ABI, input.provider);
    const result = String(await contract.isValidSignature(input.digest, input.signature)).toLowerCase();
    return result === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

async function verifyBorrowerAuthority(input: {
  provider: providers.Provider;
  borrower: string;
  authorizer: string;
  digest: string;
  signature: string;
}): Promise<'borrower_erc1271' | 'owner_eoa' | 'owner_erc1271'> {
  const borrowerCode = await input.provider.getCode(input.borrower);
  if (borrowerCode === '0x') throw new Error('GHOST_WALLET_MANDATE_BORROWER_CONTRACT_REQUIRED');

  if (input.authorizer.toLowerCase() === input.borrower.toLowerCase()) {
    const valid = await verifyErc1271({
      provider: input.provider,
      signer: input.borrower,
      digest: input.digest,
      signature: input.signature,
    });
    if (!valid) throw new Error('GHOST_WALLET_MANDATE_BORROWER_ERC1271_REJECTED');
    return 'borrower_erc1271';
  }

  const owner = await contractOwner(input.provider, input.borrower);
  if (!owner || owner.toLowerCase() !== input.authorizer.toLowerCase()) {
    throw new Error('GHOST_WALLET_MANDATE_AUTHORIZER_NOT_BORROWER_OWNER');
  }

  const authorizerCode = await input.provider.getCode(input.authorizer);
  if (authorizerCode !== '0x') {
    const valid = await verifyErc1271({
      provider: input.provider,
      signer: input.authorizer,
      digest: input.digest,
      signature: input.signature,
    });
    if (!valid) throw new Error('GHOST_WALLET_MANDATE_OWNER_ERC1271_REJECTED');
    return 'owner_erc1271';
  }

  let recovered: string;
  try {
    recovered = ethers.utils.recoverAddress(input.digest, input.signature);
  } catch {
    throw new Error('GHOST_WALLET_MANDATE_EOA_SIGNATURE_INVALID');
  }
  if (recovered.toLowerCase() !== input.authorizer.toLowerCase()) {
    throw new Error('GHOST_WALLET_MANDATE_EOA_SIGNATURE_MISMATCH');
  }
  return 'owner_eoa';
}

function domain(chainId: number, borrower: string) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: borrower,
  };
}

async function assertMandateVersionCanReplace(input: {
  mandateId: string;
  nonce: bigint;
  digest: string;
}): Promise<void> {
  const result = await pool.query(
    `SELECT enabled,metadata
     FROM private.cryptocrawler_ghost_wallet_venues
     WHERE venue_id=$1
     LIMIT 1`,
    [input.mandateId],
  );
  const row = result.rows[0];
  if (!row) return;
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
  const storedNonceRaw = String(metadata.nonce ?? '');
  const storedDigest = String(metadata.mandateDigest || '').toLowerCase();
  if (!/^\d+$/.test(storedNonceRaw)) throw new Error('GHOST_WALLET_MANDATE_STORED_NONCE_INVALID');
  const storedNonce = BigInt(storedNonceRaw);
  if (input.nonce < storedNonce) throw new Error('GHOST_WALLET_MANDATE_NONCE_NOT_NEWER');
  if (input.nonce === storedNonce) {
    if (storedDigest !== input.digest.toLowerCase()) throw new Error('GHOST_WALLET_MANDATE_NONCE_CONFLICT');
    if (metadata.cancelledAt !== undefined || row.enabled === false) {
      throw new Error('GHOST_WALLET_MANDATE_CANCELLED_REPLAY_REJECTED');
    }
  }
}

export async function registerGhostWalletBorrowerMandate(
  input: GhostWalletBorrowerMandateInput,
): Promise<RegisteredGhostWalletBorrowerMandate> {
  const borrower = asAddress(input.borrower, 'GHOST_WALLET_MANDATE_BORROWER');
  const asset = asAddress(input.asset, 'GHOST_WALLET_MANDATE_ASSET');
  const authorizer = asAddress(input.authorizer, 'GHOST_WALLET_MANDATE_AUTHORIZER');
  const authorizedAmount = amountAuthorization(input);
  const maxBorrowerFee = asUnsignedInteger(input.maxBorrowerFeeBaseUnits, 'GHOST_WALLET_MANDATE_MAX_FEE', true);
  const nonce = asUnsignedInteger(input.nonce, 'GHOST_WALLET_MANDATE_NONCE');
  const deadline = asSafeInteger(input.deadline, 'GHOST_WALLET_MANDATE_DEADLINE', true);
  const maxExecutions = asSafeInteger(input.maxExecutions, 'GHOST_WALLET_MANDATE_MAX_EXECUTIONS', true);
  const minIntervalSeconds = asSafeInteger(input.minIntervalSeconds ?? 0, 'GHOST_WALLET_MANDATE_MIN_INTERVAL');
  const deadlineMs = millisecondsFromSeconds(deadline, 'GHOST_WALLET_MANDATE_DEADLINE_MS');
  const minIntervalMs = millisecondsFromSeconds(minIntervalSeconds, 'GHOST_WALLET_MANDATE_MIN_INTERVAL_MS');
  const borrowerData = asData(input.borrowerData);
  const signature = asSignature(input.signature);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (deadline <= nowSeconds) throw new Error('GHOST_WALLET_MANDATE_EXPIRED');

  const provider = ghostWalletEngine.getProvider(input.chain);
  if (!provider) throw new Error(`GHOST_WALLET_MANDATE_PROVIDER_UNAVAILABLE:${input.chain}`);
  const [network, assetCode] = await Promise.all([provider.getNetwork(), provider.getCode(asset)]);
  if (assetCode === '0x') throw new Error('GHOST_WALLET_MANDATE_ASSET_CONTRACT_REQUIRED');

  const common = {
    authorizer,
    borrower,
    asset,
    maxBorrowerFeeBaseUnits: maxBorrowerFee.toString(),
    borrowerDataHash: ethers.utils.keccak256(borrowerData),
    nonce: nonce.toString(),
    deadline,
    maxExecutions,
    minIntervalSeconds,
  };
  const typedValue = authorizedAmount.mode === 'range'
    ? {
        ...common,
        minAmountBaseUnits: authorizedAmount.min.toString(),
        preferredAmountBaseUnits: authorizedAmount.preferred.toString(),
        maxAmountBaseUnits: authorizedAmount.max.toString(),
      }
    : { ...common, amountBaseUnits: authorizedAmount.preferred.toString() };
  const typedTypes = authorizedAmount.mode === 'range' ? BORROWER_RANGE_MANDATE_TYPES : BORROWER_MANDATE_TYPES;
  const digest = ethers.utils._TypedDataEncoder.hash(domain(network.chainId, borrower), typedTypes, typedValue);
  const authorizationMode = await verifyBorrowerAuthority({ provider, borrower, authorizer, digest, signature });
  const mandateId = `signed-borrower:${input.chain}:${borrower.toLowerCase()}:${asset.toLowerCase()}`;
  await assertMandateVersionCanReplace({ mandateId, nonce, digest });

  await upsertGhostWalletVenue({
    venueId: mandateId,
    chain: input.chain,
    protocol: 'signed_erc3156_borrower_mandate',
    role: 'borrower',
    address: borrower,
    asset,
    adapter: 'erc3156_flash_borrower',
    discoveredFrom: 'cryptographically_signed_borrower_mandate',
    verified: false,
    enabled: true,
    capabilities: {
      contractCode: true,
      signedAuthorization: true,
      authorizationMode,
      amountMode: authorizedAmount.mode,
      executionAuthority: 'signed_mandate_plus_exact_simulation',
      successfulAtomicRepaymentRequiredForVerifiedStatus: true,
      sameTransactionRepaymentRequired: true,
    },
    metadata: {
      autonomous: true,
      signedMandate: true,
      mandateDigest: digest,
      authorizer,
      authorizationMode,
      amountMode: authorizedAmount.mode,
      amountBaseUnits: authorizedAmount.preferred.toString(),
      minAmountBaseUnits: authorizedAmount.min.toString(),
      preferredAmountBaseUnits: authorizedAmount.preferred.toString(),
      maxAmountBaseUnits: authorizedAmount.max.toString(),
      maxBorrowerFeeBaseUnits: maxBorrowerFee.toString(),
      borrowerData,
      borrowerDataHash: common.borrowerDataHash,
      nonce: nonce.toString(),
      deadline,
      expiresAt: deadlineMs,
      maxExecutions,
      minIntervalSeconds,
      minIntervalMs,
      signatureHash: ethers.utils.keccak256(signature),
    },
  });
  ghostWalletWorkSignal.emitWake('explicit_refresh');

  return {
    mandateId,
    digest,
    chain: input.chain,
    chainId: network.chainId,
    borrower,
    asset,
    authorizer,
    authorizationMode,
    amountMode: authorizedAmount.mode,
    amountBaseUnits: authorizedAmount.preferred.toString(),
    minAmountBaseUnits: authorizedAmount.min.toString(),
    preferredAmountBaseUnits: authorizedAmount.preferred.toString(),
    maxAmountBaseUnits: authorizedAmount.max.toString(),
    maxBorrowerFeeBaseUnits: maxBorrowerFee.toString(),
    borrowerData,
    nonce: nonce.toString(),
    deadline,
    maxExecutions,
    minIntervalSeconds,
  };
}

export async function cancelGhostWalletBorrowerMandate(input: {
  mandateId: string;
  authorizer: string;
  deadline: number;
  signature: string;
}): Promise<{ mandateId: string; cancelled: true }> {
  const mandateId = String(input.mandateId || '').trim();
  if (!mandateId) throw new Error('GHOST_WALLET_MANDATE_ID_REQUIRED');
  const authorizer = asAddress(input.authorizer, 'GHOST_WALLET_MANDATE_CANCEL_AUTHORIZER');
  const deadline = asSafeInteger(input.deadline, 'GHOST_WALLET_MANDATE_CANCEL_DEADLINE', true);
  if (deadline <= Math.floor(Date.now() / 1000)) throw new Error('GHOST_WALLET_MANDATE_CANCEL_EXPIRED');
  const signature = asSignature(input.signature);

  const result = await pool.query(
    `SELECT venue_id,chain,address,metadata
     FROM private.cryptocrawler_ghost_wallet_venues
     WHERE venue_id=$1 AND protocol='signed_erc3156_borrower_mandate'
     LIMIT 1`,
    [mandateId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('GHOST_WALLET_MANDATE_NOT_FOUND');
  const chain = String(row.chain).trim().toLowerCase() as GhostWalletChain;
  const borrower = asAddress(row.address, 'GHOST_WALLET_MANDATE_CANCEL_BORROWER');
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
  const originalAuthorizer = asAddress(metadata.authorizer, 'GHOST_WALLET_MANDATE_STORED_AUTHORIZER');
  if (originalAuthorizer.toLowerCase() !== authorizer.toLowerCase()) {
    throw new Error('GHOST_WALLET_MANDATE_CANCEL_AUTHORIZER_MISMATCH');
  }
  const mandateDigest = String(metadata.mandateDigest || '').trim();
  if (!ethers.utils.isHexString(mandateDigest, 32)) throw new Error('GHOST_WALLET_MANDATE_STORED_DIGEST_INVALID');
  const provider = ghostWalletEngine.getProvider(chain);
  if (!provider) throw new Error(`GHOST_WALLET_MANDATE_PROVIDER_UNAVAILABLE:${chain}`);
  const network = await provider.getNetwork();
  const cancelDigest = ethers.utils._TypedDataEncoder.hash(
    domain(network.chainId, borrower),
    CANCELLATION_TYPES,
    { authorizer, mandateDigest, deadline },
  );
  await verifyBorrowerAuthority({ provider, borrower, authorizer, digest: cancelDigest, signature });

  const update = await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_venues
     SET enabled=false,
         metadata=metadata || $2::jsonb,
         updated_at=now()
     WHERE venue_id=$1
     RETURNING venue_id`,
    [mandateId, JSON.stringify({ cancelledAt: Date.now(), cancellationDigest: cancelDigest })],
  );
  if (update.rowCount !== 1) throw new Error('GHOST_WALLET_MANDATE_CANCEL_UPDATE_FAILED');
  ghostWalletWorkSignal.emitWake('explicit_refresh');
  return { mandateId, cancelled: true };
}

export const GHOST_WALLET_BORROWER_MANDATE_POLICY = {
  borrowerBytecodeRequired: true,
  assetBytecodeRequired: true,
  authorizationAlternatives: ['borrower_erc1271', 'owner_eoa', 'owner_erc1271'] as const,
  signedAuthorizationCreatesVerifiedRepaymentEvidence: false,
  exactSimulationStillRequiredBeforeExecution: true,
  exactAmountMandatesRemainBackwardCompatible: true,
  rangeAuthorizedDynamicSizing: true,
  rangeAuthorizationFields: ['minAmountBaseUnits', 'preferredAmountBaseUnits', 'maxAmountBaseUnits'] as const,
  explicitExecutionCountRequired: true,
  explicitExpiryRequired: true,
  monotonicNonceRequiredForReplacement: true,
  cancelledMandateReplayRejected: true,
  onePersistentMandatePerBorrowerAsset: true,
  cancellationSignedBySameAuthority: true,
  zeroCapitalDependency: false,
} as const;
