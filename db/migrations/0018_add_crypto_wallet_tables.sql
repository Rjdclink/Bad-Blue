-- Add crypto wallet table for STARBURST agent system
CREATE TABLE IF NOT EXISTS crypto_wallets (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  address VARCHAR(42) NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL,
  mnemonic TEXT,
  chains JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_wallets_address ON crypto_wallets(address);

-- Add crypto transactions table for tracking agent trades
CREATE TABLE IF NOT EXISTS crypto_transactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id VARCHAR NOT NULL REFERENCES crypto_wallets(id) ON DELETE CASCADE,
  chain VARCHAR(20) NOT NULL,
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount VARCHAR NOT NULL,
  asset VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  agent_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_transactions_wallet ON crypto_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_crypto_transactions_chain ON crypto_transactions(chain);
CREATE INDEX IF NOT EXISTS idx_crypto_transactions_hash ON crypto_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_crypto_transactions_agent ON crypto_transactions(agent_id);
