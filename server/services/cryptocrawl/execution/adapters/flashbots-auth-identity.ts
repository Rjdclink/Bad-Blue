import { normalizePrivateKey } from '../../core/wallet-identity.js';

/**
 * Canonical Flashbots auth identity authority.
 *
 * Authentication private keys are secrets and must never be generated into or
 * recovered from an API-exposed application table. Railway/Vault-style secret
 * storage is the authority; callers may pass an explicit secret for tests or
 * controlled bootstrapping. The historical function name is retained so the
 * execution graph does not regress while persistence is removed.
 */
export async function getOrCreateFlashbotsAuthPrivateKey(
  preferredPrivateKey?: string,
): Promise<string> {
  const raw = preferredPrivateKey?.trim() || process.env.FLASHBOTS_AUTH_KEY?.trim();
  if (!raw) {
    throw new Error('FLASHBOTS_AUTH_KEY is required for Flashbots execution');
  }

  const normalized = normalizePrivateKey(raw);
  if (!normalized) {
    throw new Error('FLASHBOTS_AUTH_KEY is invalid; refusing Flashbots execution');
  }

  return normalized;
}
