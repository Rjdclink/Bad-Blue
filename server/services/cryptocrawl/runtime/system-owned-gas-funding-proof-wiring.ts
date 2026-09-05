import { chooseGasFundingMode, type GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { zeroCapitalEngine, type SupportedChain } from '../core/zero-capital-engine.js';
import { getSystemNativeGasAuthority } from '../execution/system-native-gas-spend-authority.js';

const installed = new WeakSet<object>();

/**
 * Bridges the strict gas-selection boundary to the durable ownership ledger.
 * A provider policy is never promoted to zero-operator-cost proof here. Native
 * balance is eligible only when the same chain/wallet has enough uncommitted,
 * reimbursement-verified gas inside one SELF_FUNDED scope.
 */
export function ensureSystemOwnedGasFundingProofWiring(): void {
  const runtime = zeroCapitalEngine as any;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const original = runtime.getGasFundingDecision.bind(runtime) as (chain: SupportedChain) => Promise<GasFundingDecision>;
  runtime.getGasFundingDecision = async (chain: SupportedChain): Promise<GasFundingDecision> => {
    if (chain === 'europa') return original(chain);
    const provider = runtime.providers?.get(chain);
    const wallet = runtime.executionWallets?.get(chain);
    const config = runtime.dynamicChainConfigs?.get(chain);
    if (!provider || !wallet || !config) return original(chain);

    try {
      const nativeBalance = (await provider.getBalance(wallet.address)).toBigInt();
      const sponsorReady = runtime.gasSponsor?.getReadiness?.().ready === true;
      const unproven = chooseGasFundingMode(config, nativeBalance, sponsorReady, {
        sponsorOperatorMonetaryCostProvenZero: false,
        nativeSystemOwnedProven: false,
      });

      // Do not query ownership state when the wallet cannot satisfy the canonical
      // reserve floor. Hosted sponsorship remains unproven by design.
      if (nativeBalance < unproven.reserveFloor || unproven.reserveFloor <= 0n) return unproven;

      const authority = await getSystemNativeGasAuthority({
        chain,
        wallet: wallet.address,
        minimumWei: unproven.reserveFloor.toString(),
      });
      return chooseGasFundingMode(config, nativeBalance, sponsorReady, {
        sponsorOperatorMonetaryCostProvenZero: false,
        nativeSystemOwnedProven: authority !== null && BigInt(authority.spendableWei) >= unproven.reserveFloor,
      });
    } catch {
      // Any database/RPC/provenance ambiguity retains the existing fail-closed
      // decision rather than converting an unexplained wallet balance to capital.
      return original(chain);
    }
  };
}