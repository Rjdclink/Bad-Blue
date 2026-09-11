export function kalshiLiveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

export function kalshiCrossVenueLiveExecutionEnabled(): boolean {
  return kalshiLiveExecutionEnabled();
}

export function kalshiMakerLiveExecutionEnabled(): boolean {
  return kalshiLiveExecutionEnabled();
}
