-- Persist destination failover state so a confirmed failed primary withdrawal can
-- retry to the canonical Railway execution-wallet address without ever reusing
-- the primary withdrawal id/client id or exposing the private key.

ALTER TABLE public.cryptocrawler_profit_payout_batches
  ADD COLUMN IF NOT EXISTS destination_mode text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS primary_failure_withdrawal_id text,
  ADD COLUMN IF NOT EXISTS primary_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_failure_reason text;

ALTER TABLE public.cryptocrawler_profit_payout_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_profit_payout_batches_destination_mode_check;
ALTER TABLE public.cryptocrawler_profit_payout_batches
  ADD CONSTRAINT cryptocrawler_profit_payout_batches_destination_mode_check
  CHECK (destination_mode IN ('primary','fallback'));

ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  ADD COLUMN IF NOT EXISTS destination_mode text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS primary_failure_withdrawal_id text,
  ADD COLUMN IF NOT EXISTS primary_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_failure_reason text;

ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  DROP CONSTRAINT IF EXISTS cryptocrawler_terminal_sweep_legs_destination_mode_check;
ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  ADD CONSTRAINT cryptocrawler_terminal_sweep_legs_destination_mode_check
  CHECK (destination_mode IN ('primary','fallback'));

COMMENT ON COLUMN public.cryptocrawler_profit_payout_batches.destination_mode IS
  'primary = configured MetaMask payout address; fallback = Railway WALLET_PRIVATE_KEY-derived public Ethereum address after a confirmed terminal primary-withdrawal failure.';
COMMENT ON COLUMN public.cryptocrawler_terminal_sweep_legs.destination_mode IS
  'Durable restart-drain destination selector. Fallback is armed only after OKX reports the primary withdrawal in a terminal failure state.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_batches.primary_failure_withdrawal_id IS
  'Preserves the failed primary OKX withdrawal id when a batch switches to the fallback destination.';
COMMENT ON COLUMN public.cryptocrawler_terminal_sweep_legs.primary_failure_withdrawal_id IS
  'Preserves the failed primary OKX withdrawal id when a restart-drain leg switches to the fallback destination.';
COMMENT ON TABLE public.cryptocrawler_profit_payout_jobs IS
  'Durable terminal-profit allocation. The first three profitable settlements use a fixed 60% payout/40% retained split; later settlements persist one bounded 55-65% payout decision with the complementary 45-35% retained for operating capital.';
COMMENT ON TABLE public.cryptocrawler_profit_payout_batches IS
  'Idempotent OKX ETH/Ethereum payout batches. Small due obligations may aggregate to the authenticated minimum; large obligations may span batches up to the authenticated maximum; primary destination failure may fail over once to the Railway-derived public Ethereum address.';
