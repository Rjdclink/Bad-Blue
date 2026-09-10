import { Contract, ethers } from 'ethers';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import type { GhostWalletCapitalQuote } from './capital-fabric.js';
import {
  enqueueGhostWalletWork,
  upsertGhostWalletVenue,
} from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';

const GHOST_VAULT_ABI = [
  'function asset() view returns (address)',
  'function intermediary() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function previewAtomicFee(uint256 assets) view returns (uint256)',
];

export interface GhostWalletVenueCandidate {
  venueId: string;
  chain: string;
  protocol: string;
  role: 'lender' | 'borrower' | 'both';
  address: string;
  asset?: string | null;
  adapter: string;
  discoveredFrom: string;
  metadata?: Record<string, unknown>;
}

function normalizedChain(value: string): string { return value.trim().toLowerCase(); }
function address(value: string): string { return ethers.utils.getAddress(value.trim()); }

function quoteRole(quote: GhostWalletCapitalQuote): 'lender' | 'borrower' | 'both' {
  if (quote.primitive === 'signed_intent_capital' || quote.primitive === 'coincidence_of_wants') return 'both';
  return 'lender';
}

export async function syncMeasuredGhostWalletVenues(quotes: readonly GhostWalletCapitalQuote[]): Promise<number> {
  await Promise.all(quotes.map(quote => upsertGhostWalletVenue({
    venueId: `measured:${quote.quoteId}`,
    chain: normalizedChain(quote.chain),
    protocol: quote.primitive,
    role: quoteRole(quote),
    address: address(quote.sourceAddress),
    asset: quote.asset ? address(quote.asset) : null,
    adapter: quote.executionSurface,
    capabilities: {
      resourceForm: quote.resourceForm,
      sameTransactionSettlement: quote.sameTransactionSettlement,
      repaymentFailureReverts: quote.repaymentFailureReverts,
      exactSimulationRequired: quote.exactSimulationRequired,
      apiKeyRequired: quote.apiKeyRequired,
      signupRequired: quote.signupRequired,
      availablePrincipal: quote.availablePrincipal.toString(),
      variableFeeBps: quote.variableFeeBps,
      fixedFee: quote.fixedFee.toString(),
      reliabilityScore: quote.reliabilityScore,
      expiresAt: quote.expiresAt,
    },
    discoveredFrom: quote.provenance.join('|').slice(0, 2_000) || 'measured_capital_quote',
    verified: quote.measured === true && quote.expiresAt > Date.now(),
    metadata: quote.metadata || {},
  })));
  return quotes.length;
}

/**
 * Adds a venue candidate without imposing a universe-size ceiling. A candidate is
 * never executable merely because it was discovered; its adapter must prove live
 * bytecode/identity/capability before it is marked verified.
 */
export async function submitGhostWalletVenueCandidate(candidate: GhostWalletVenueCandidate): Promise<void> {
  const normalized: GhostWalletVenueCandidate = {
    ...candidate,
    chain: normalizedChain(candidate.chain),
    address: address(candidate.address),
    asset: candidate.asset ? address(candidate.asset) : null,
  };
  await upsertGhostWalletVenue({
    ...normalized,
    verified: false,
    enabled: true,
    capabilities: { discovered: true, executableAuthority: false },
  });
  await enqueueGhostWalletWork({
    dedupeKey: `venue-probe:${normalized.venueId}:${Date.now()}`,
    kind: 'venue_probe',
    chain: normalized.chain,
    priority: 250,
    maxAttempts: 8,
    payload: normalized as unknown as Record<string, unknown>,
  });
  ghostWalletWorkSignal.emitWake('local_work_enqueued');
}

export async function probeGhostWalletVenueCandidate(payload: Record<string, unknown>): Promise<{
  verified: boolean;
  reason: string;
  candidate: GhostWalletVenueCandidate;
}> {
  const candidate: GhostWalletVenueCandidate = {
    venueId: String(payload.venueId || ''),
    chain: normalizedChain(String(payload.chain || '')),
    protocol: String(payload.protocol || ''),
    role: (payload.role === 'borrower' || payload.role === 'both') ? payload.role : 'lender',
    address: address(String(payload.address || '')),
    asset: payload.asset ? address(String(payload.asset)) : null,
    adapter: String(payload.adapter || ''),
    discoveredFrom: String(payload.discoveredFrom || 'runtime_candidate'),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata as Record<string, unknown> : {},
  };
  if (!candidate.venueId || !candidate.protocol || !candidate.adapter || !candidate.chain) {
    throw new Error('GHOST_WALLET_VENUE_CANDIDATE_INCOMPLETE');
  }
  const provider = ghostWalletEngine.getProvider(candidate.chain);
  if (!provider) throw new Error(`GHOST_WALLET_VENUE_PROVIDER_UNAVAILABLE:${candidate.chain}`);
  const code = await provider.getCode(candidate.address);
  if (code === '0x') {
    await upsertGhostWalletVenue({ ...candidate, verified: false, enabled: true, capabilities: { contractCode: false } });
    return { verified: false, reason: 'contract_code_unavailable', candidate };
  }

  // ERC-3156 borrowers are permissionless callers of the broker. Code presence is
  // discovery evidence only; they become verified borrowers exclusively after a
  // successful BrokeredAtomicCreditSettled event proves callback + exact repayment.
  if (candidate.adapter === 'erc3156_flash_borrower') {
    await upsertGhostWalletVenue({
      ...candidate,
      verified: false,
      enabled: true,
      capabilities: { contractCode: true, executionAuthority: false, successfulAtomicRepaymentRequired: true },
    });
    return { verified: false, reason: 'awaiting_successful_atomic_repayment_evidence', candidate };
  }

  if (candidate.adapter === 'ghost_wallet_capital_vault') {
    const intermediary = ghostWalletEngine.getConfiguredIntermediary(candidate.chain);
    if (!intermediary) throw new Error('GHOST_WALLET_VENUE_INTERMEDIARY_UNAVAILABLE');
    const vault = new Contract(candidate.address, GHOST_VAULT_ABI, provider);
    const [assetRaw, intermediaryRaw, assetsRaw] = await Promise.all([
      vault.asset(), vault.intermediary(), vault.totalAssets(),
    ]);
    const vaultAsset = address(String(assetRaw));
    const boundIntermediary = address(String(intermediaryRaw));
    if (candidate.asset && candidate.asset.toLowerCase() !== vaultAsset.toLowerCase()) {
      throw new Error('GHOST_WALLET_VENUE_ASSET_MISMATCH');
    }
    if (boundIntermediary.toLowerCase() !== intermediary.toLowerCase()) {
      throw new Error('GHOST_WALLET_VENUE_INTERMEDIARY_MISMATCH');
    }
    const testAmount = BigInt(String(assetsRaw)) > 0n ? 1 : 0;
    if (testAmount > 0) await vault.previewAtomicFee(testAmount);
    await upsertGhostWalletVenue({
      ...candidate,
      asset: vaultAsset,
      verified: true,
      enabled: true,
      capabilities: {
        contractCode: true,
        intermediaryBindingVerified: true,
        atomicFeeSurfaceVerified: testAmount > 0,
        sameTransactionSettlement: true,
      },
      metadata: { ...(candidate.metadata || {}), totalAssets: String(assetsRaw) },
    });
    return { verified: true, reason: 'ghost_wallet_vault_identity_and_atomic_surface_verified', candidate: { ...candidate, asset: vaultAsset } };
  }

  // Adapter expansion is intentionally open-ended. Unknown adapters are retained
  // for future capability modules but never promoted to executable evidence.
  await upsertGhostWalletVenue({
    ...candidate,
    verified: false,
    enabled: true,
    capabilities: { contractCode: true, adapterImplemented: false, executionAuthority: false },
  });
  return { verified: false, reason: 'adapter_not_implemented_fail_closed', candidate };
}

export const GHOST_WALLET_VENUE_UNIVERSE_POLICY = {
  hardVenueCountLimit: null,
  discoveryAdmissionCreatesExecutionAuthority: false,
  successfulBorrowerRepaymentCreatesVerifiedEvidence: true,
  measuredLenderCapacityRequired: true,
  dynamicExpansion: true,
} as const;
