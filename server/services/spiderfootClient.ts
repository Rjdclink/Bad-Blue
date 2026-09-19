import { cacheService } from './redisCache';

export class SpiderFootClient {
  private baseUrl = process.env.SPIDERFOOT_URL || 'http://localhost:5001';

  private async fetchJsonCandidates(paths: string[], init?: RequestInit): Promise<any> {
    let lastError: unknown = null;
    for (const path of paths) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, init);
        if (!res.ok) {
          lastError = new Error(`SpiderFoot HTTP ${res.status} for ${path}`);
          continue;
        }
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          lastError = new Error(`SpiderFoot returned non-JSON data for ${path}`);
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('SpiderFoot request failed');
  }

  private normalizeStatus(payload: any, scanId: string): string | null {
    const direct = payload?.status || payload?.scanStatus || payload?.state;
    if (typeof direct === 'string') return direct.toUpperCase();

    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.scans) ? payload.scans : [];
    for (const row of rows) {
      if (Array.isArray(row)) {
        const id = String(row[0] ?? '');
        if (id === scanId && typeof row[6] === 'string') return row[6].toUpperCase();
      } else if (row && typeof row === 'object') {
        const id = String(row.id ?? row.scanId ?? row.scan_id ?? '');
        if (id === scanId) {
          const status = row.status ?? row.scanStatus ?? row.state;
          if (typeof status === 'string') return status.toUpperCase();
        }
      }
    }
    return null;
  }

  async startScan(target: string): Promise<string> {
    try {
      const scanName = `scan-${Date.now()}`;
      let data: any;
      try {
        data = await this.fetchJsonCandidates(['/api/startscan'], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanname: scanName,
            scantarget: target,
            modulelist: 'sfp_sociallinks',
          }),
        });
      } catch {
        const form = new URLSearchParams({
          scanname: scanName,
          scantarget: target,
          modulelist: 'sfp_sociallinks',
        });
        data = await this.fetchJsonCandidates(['/startscan'], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          redirect: 'manual',
        });
      }
      const scanId = data?.id || data?.scanId || data?.scan_id;
      if (!scanId) throw new Error('SpiderFoot did not return a scan ID');
      return String(scanId);
    } catch (error) {
      console.error('[SpiderFoot] Start scan failed:', error);
      throw error;
    }
  }

  async getScanResults(scanId: string): Promise<any> {
    const cacheKey = `spiderfoot:${scanId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    try {
      const data = await this.fetchJsonCandidates(
        [
          `/api/scanresults?id=${encodeURIComponent(scanId)}`,
          `/scaneventresults?id=${encodeURIComponent(scanId)}&eventType=ALL`,
          `/scanexportjsonmulti?ids=${encodeURIComponent(scanId)}`,
        ],
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      
      await cacheService.set(cacheKey, data, 'warm');
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[SpiderFoot] Get scan results failed:', error);
      throw error;
    }
  }

  async getScanStatus(scanId: string): Promise<string | null> {
    try {
      const payload = await this.fetchJsonCandidates([
        `/api/scanstatus?id=${encodeURIComponent(scanId)}`,
        '/api/scanlist',
        '/scanlist',
      ]);
      return this.normalizeStatus(payload, scanId);
    } catch {
      return null;
    }
  }

  async waitForScanCompletion(
    scanId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<string> {
    const timeoutMs = Math.max(5_000, options.timeoutMs ?? 120_000);
    const pollIntervalMs = Math.max(500, options.pollIntervalMs ?? 1_500);
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(['FINISHED', 'ABORTED', 'ABORT-REQUESTED', 'ERROR-FAILED']);

    while (Date.now() < deadline) {
      const status = await this.getScanStatus(scanId);
      if (status && terminal.has(status)) {
        if (status !== 'FINISHED') {
          throw new Error(`SpiderFoot scan ended with status ${status}`);
        }
        return status;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`SpiderFoot scan timed out after ${timeoutMs}ms`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const spiderfootClient = new SpiderFootClient();
