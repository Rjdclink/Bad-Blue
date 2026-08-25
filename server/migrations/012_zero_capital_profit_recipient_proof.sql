ALTER TABLE zero_capital_capital_state
  ADD COLUMN IF NOT EXISTS source_recipient varchar(42),
  ADD COLUMN IF NOT EXISTS source_recipient_balance_before_base_units text,
  ADD COLUMN IF NOT EXISTS source_recipient_balance_after_base_units text;
