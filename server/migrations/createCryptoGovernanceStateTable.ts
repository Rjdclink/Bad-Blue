import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createCryptoGovernanceStateTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cryptocrawl_governance_state (
      scope varchar(64) PRIMARY KEY,
      state jsonb NOT NULL,
      state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
}