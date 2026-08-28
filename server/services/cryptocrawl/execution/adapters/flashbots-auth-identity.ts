import { Wallet } from 'ethers';
import { normalizePrivateKey } from '../../core/wallet-identity.js';

export interface FlashbotsAuthIdentityStore {
  load(): Promise<string | null>;
  save(privateKey: string): Promise<void>;
}

export class PostgresFlashbotsAuthIdentityStore implements FlashbotsAuthIdentityStore {
  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../../../../db.js');
    return pool.query(text, values);
  }

  async load(): Promise<string | null> {
    const result = await this.query(
      'SELECT private_key FROM cryptocrawl_flashbots_auth_identity WHERE scope = $1',
      ['canonical'],
    );
    const value = result.rows[0]?.private_key;
    return value === undefined || value === null ? null : String(value);
  }

  async save(privateKey: string): Promise<void> {
    await this.query(
      `INSERT INTO cryptocrawl_flashbots_auth_identity (scope, private_key, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (scope) DO NOTHING`,
      ['canonical', privateKey],
    );
  }
}

export async function getOrCreateFlashbotsAuthPrivateKey(
  preferredPrivateKey?: string,
  store: FlashbotsAuthIdentityStore = new PostgresFlashbotsAuthIdentityStore(),
): Promise<string> {
  const storedValue = await store.load();
  const existing = normalizePrivateKey(storedValue || undefined);
  if (storedValue && !existing) {
    throw new Error('Persisted Flashbots auth identity is invalid; refusing to replace it automatically');
  }
  if (existing) return existing;

  const preferred = normalizePrivateKey(preferredPrivateKey);
  const generated = preferred || Wallet.createRandom().privateKey;
  await store.save(generated);
  const persisted = normalizePrivateKey(await store.load() || undefined);
  if (!persisted) throw new Error('Persisted Flashbots auth identity could not be validated');
  return persisted;
}
