import { BaseCrawler } from '../baseCrawler';
import { EntropySignature, CrawlerType, CrawlerTask, TimingJitterResult, AsyncEchoResult } from '../core';

/**
 * WRAITH CRAWLER - Ghost Layer Entropy Harvester
 * 
 * Harvests entropy from the "negative space" of computation:
 * - Timing jitter (variance in response times)
 * - Async echoes (handler signatures)
 * - TCP ghost states
 * 
 * Wraiths fail silently - they leave no trace.
 */
export class WraithCrawler extends BaseCrawler {
  constructor(task: CrawlerTask) {
    super(task, CrawlerType.WRAITH);
  }

  async execute(): Promise<EntropySignature[]> {
    const signatures: EntropySignature[] = [];
    
    try {
      // Harvest timing jitter
      const timings = await this.measureTimingJitter(this.task.target);
      signatures.push(this.generateEntropySignature({ 
        type: 'timing', 
        ...timings 
      }));
      
      // Detect async echoes
      const async = await this.detectAsyncEchoes(this.task.target);
      signatures.push(this.generateEntropySignature({ 
        type: 'async', 
        ...async 
      }));
    } catch {
      // Ghosts fail silently
    }
    
    return signatures;
  }

  /**
   * Measure timing jitter (variance in response times)
   * Takes 5 samples with 100ms gaps
   * 
   * High jitter = unstable system = exploitable entropy
   */
  private async measureTimingJitter(target: string): Promise<TimingJitterResult> {
    const measurements: number[] = [];
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        
        await fetch(target, { 
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        measurements.push(Date.now() - start);
      } catch {
        // Failed requests still provide timing data
        measurements.push(Date.now() - start);
      }
      
      await this.sleep(100);
    }
    
    // Calculate variance and jitter
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const variance = measurements.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / measurements.length;
    const jitter = Math.sqrt(variance);
    
    return { 
      avg, 
      variance, 
      jitter,
      samples: measurements.length,
      stability: jitter / avg // Lower = more stable
    };
  }

  /**
   * Detect async handler signatures
   * Probes for async processing indicators
   */
  private async detectAsyncEchoes(target: string): Promise<AsyncEchoResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      
      const response = await fetch(target, { 
        headers: { 
          'User-Agent': 'Mozilla/5.0',
          'X-Ghost-Probe': 'true' // Ghost signature
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      return {
        asyncDetected: !!response.headers.get('x-async'),
        serverSignature: response.headers.get('server') || 'unknown',
        hasAsyncHeader: !!response.headers.get('x-async-context'),
        statusCode: response.status,
        responseTime: response.headers.get('x-response-time') || null
      };
    } catch {
      return { 
        asyncDetected: false,
        error: true 
      };
    }
  }
}
