import logger from '../../../logger.js';

// CryptoCrawler treasury authority lives only on Overflow. If the Overflow URL or
// Overflow service credential is unavailable, immediate wake-up fails closed and
// durable Overflow state remains pending. General/Primary Supabase variables are
// deliberately not accepted as a payout-control-plane fallback.
const SUPABASE_URL = (
  process.env.SUPABASE_URL_OVERFLOW ||
  ''
).trim().replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = (
  process.env.SUPABASE_SECRET_KEY_OVERFLOW ||
  process.env.SUPABASE_SERVICEROLE_OVERFLOW_KEY ||
  ''
).trim();
const WAKE_TIMEOUT_MS = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_RAINBOW_WORKER_WAKE_TIMEOUT_MS || 8_000)));

type TreasuryWakeReason = 'terminal_profit_recorded' | 'startup_reconcile' | 'terminal_candidate';

/**
 * Rainbow Bridge is deliberately a wake-up client, not an exchange-withdrawal
 * authority. The single durable payout/terminal-sweep authority lives in the
 * Overflow Supabase Edge Function so a Railway process restart cannot create a
 * second converter, transfer agent, or withdrawal signer.
 *
 * The independent scheduler remains the fallback. A wake merely asks the same
 * Overflow worker to process already-persisted treasury state sooner.
 */
class RainbowProfitBridge {
  private inFlight: Promise<boolean> | null = null;
  private wakeAgain = false;

  async wake(reason: TreasuryWakeReason = 'terminal_profit_recorded'): Promise<boolean> {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      logger.warn('[RainbowBridge] Immediate payout-worker wake unavailable; durable Overflow scheduler remains authoritative', {
        component: 'RainbowProfitBridge',
        overflowSupabaseUrlConfigured: Boolean(SUPABASE_URL),
        overflowServiceKeyConfigured: Boolean(SUPABASE_SERVICE_KEY),
        payoutAuthority: 'overflow_only',
        primaryFallbackUsed: false,
        payoutAuthorityDuplicated: false,
      });
      return false;
    }

    if (this.inFlight) {
      this.wakeAgain = true;
      return this.inFlight;
    }

    this.inFlight = this.invoke(reason)
      .finally(async () => {
        this.inFlight = null;
        if (this.wakeAgain) {
          this.wakeAgain = false;
          void this.wake('terminal_profit_recorded');
        }
      });
    return this.inFlight;
  }

  private async invoke(reason: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/cryptocrawler-terminal-sweeper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ reason }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`treasury worker wake failed with HTTP ${response.status}`);
      const payload = await response.json().catch(() => ({}));
      if (payload?.ok === false) throw new Error(String(payload?.error || payload?.reason || 'treasury worker rejected wake'));
      return true;
    } catch (error) {
      logger.warn('[RainbowBridge] Immediate worker wake deferred; persistent Overflow treasury state remains for scheduler retry', {
        component: 'RainbowProfitBridge',
        reason,
        error: error instanceof Error ? error.message : String(error),
        payoutAuthority: 'overflow_only',
        primaryFallbackUsed: false,
        payoutAuthorityDuplicated: false,
        durableSchedulerFallback: true,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const rainbowProfitBridge = new RainbowProfitBridge();