import logger from '../../../logger.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const WAKE_TIMEOUT_MS = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_RAINBOW_WORKER_WAKE_TIMEOUT_MS || 8_000)));

/**
 * Rainbow Bridge is deliberately a wake-up client, not an exchange-withdrawal
 * authority. The single durable payout/terminal-sweep authority lives in the
 * Supabase Edge Function so a Railway process restart cannot create a second
 * converter, transfer agent, or withdrawal signer.
 *
 * pg_cron remains the independent fallback. A wake merely asks the same worker
 * to process the already-persisted per-trade job sooner.
 */
class RainbowProfitBridge {
  private inFlight: Promise<boolean> | null = null;
  private wakeAgain = false;

  async wake(reason: 'terminal_profit_recorded' | 'startup_reconcile' = 'terminal_profit_recorded'): Promise<boolean> {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      logger.warn('[RainbowBridge] Immediate payout-worker wake unavailable; durable cron fallback remains authoritative', {
        component: 'RainbowProfitBridge',
        supabaseUrlConfigured: Boolean(SUPABASE_URL),
        serviceKeyConfigured: Boolean(SUPABASE_SERVICE_KEY),
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
      if (!response.ok) {
        throw new Error(`treasury worker wake failed with HTTP ${response.status}`);
      }
      const payload = await response.json().catch(() => ({}));
      if (payload?.ok === false) throw new Error(String(payload?.error || payload?.reason || 'treasury worker rejected wake'));
      return true;
    } catch (error) {
      logger.warn('[RainbowBridge] Immediate worker wake deferred; persistent job remains queued for cron retry', {
        component: 'RainbowProfitBridge',
        reason,
        error: error instanceof Error ? error.message : String(error),
        payoutAuthorityDuplicated: false,
        durableCronFallback: true,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const rainbowProfitBridge = new RainbowProfitBridge();