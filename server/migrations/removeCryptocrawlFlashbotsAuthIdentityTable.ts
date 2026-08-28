import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Converge runtime schema away from API-exposed secret persistence.
 * Flashbots auth identity is supplied by secret storage (FLASHBOTS_AUTH_KEY).
 * Idempotent so both upgraded and fresh environments reach the same state.
 */
export async function removeCryptocrawlFlashbotsAuthIdentityTable(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS cryptocrawl_flashbots_auth_identity`);
}
