CREATE TABLE IF NOT EXISTS cryptocrawl_flashbots_auth_identity (
  scope varchar(64) PRIMARY KEY,
  private_key varchar(66) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);