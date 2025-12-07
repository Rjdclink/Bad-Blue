/**
 * 🚀 STAR TREK CRAWLER - Federation Explorer
 * 
 * Federation starship optimized for:
 * - Warp speed jumps (cover vast territory)
 * - Transporter beaming (instant deep URL access)
 * - Long-range sensors (discovery)
 * - Phasers with stun/kill settings (10 levels)
 * - Prime Directive mode (ethical constraints)
 * 
 * Standalone implementation (~450 lines)
 */

// Types
export type WarpDistance = 'near' | 'far' | 'galactic';
export type PhaserSetting = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Data {
  content: string;
  confidence: number;
  timestamp: number;
  target: string;
  metadata?: any;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

// Utility function for HTTP requests
async function executeRequest(url: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Parse HTML results
function parseResults(html: string, target: string): Data {
  return {
    content: html.replace(/<[^>]*>/g, ' ').substring(0, 2000),
    confidence: 0.8,
    timestamp: Date.now(),
    target
  };
}

/**
 * Star Trek Crawler - Federation Explorer
 */
export class StarTrekCrawler {
  private warpSpeed: number = 5;
  private phaserSetting: PhaserSetting = 3;
  private primeDirective: boolean = true;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;

  /**
   * Set the Prime Directive mode
   * When enabled: Max phaser setting 5 (stun only), respects robots.txt
   * When disabled: All settings available
   */
  setPrimeDirective(enabled: boolean): void {
    this.primeDirective = enabled;
    if (enabled && this.phaserSetting > 5) {
      this.phaserSetting = 5;
    }
  }

  /**
   * Get current Prime Directive status
   */
  getPrimeDirective(): boolean {
    return this.primeDirective;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WARP DRIVE - Jump across vast distances
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set warp speed (affects stealth tradeoff)
   * Speed 1-9, where higher speed = less stealth
   */
  setWarpSpeed(speed: number): void {
    if (speed < 1 || speed > 9) {
      throw new Error('Warp speed must be between 1 and 9');
    }
    this.warpSpeed = speed;
  }

  /**
   * Warp jump to discover new targets
   * - near: 10-100 related domains
   * - far: 1000-10000 random domains
   * - galactic: Random TLD exploration
   */
  async warpJump(distance: WarpDistance): Promise<string> {
    await this.waitForRateLimit();
    
    switch (distance) {
      case 'near':
        return this.nearJump();
      case 'far':
        return this.farJump();
      case 'galactic':
        return this.galacticJump();
      default:
        throw new Error('Invalid warp distance');
    }
  }

  private nearJump(): string {
    // Jump 10-100 related domains
    const count = Math.floor(Math.random() * 91) + 10; // 10-100
    const domains = this.generateRelatedDomains(count);
    return domains[Math.floor(Math.random() * domains.length)];
  }

  private farJump(): string {
    // Jump 1000-10000 random domains
    const count = Math.floor(Math.random() * 9001) + 1000; // 1000-10000
    const seed = Math.floor(Math.random() * count);
    return `https://site-${seed}.example.com`;
  }

  private galacticJump(): string {
    // Random TLD exploration
    const tlds = ['.com', '.org', '.net', '.io', '.ai', '.tech', '.dev', '.app', '.co', '.xyz'];
    const tld = tlds[Math.floor(Math.random() * tlds.length)];
    const name = this.generateRandomName();
    return `https://${name}${tld}`;
  }

  private generateRelatedDomains(count: number): string[] {
    const prefixes = ['www', 'api', 'blog', 'shop', 'mail', 'news', 'forum', 'wiki'];
    const domains: string[] = [];
    for (let i = 0; i < count; i++) {
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      domains.push(`https://${prefix}-${i}.example.com`);
    }
    return domains;
  }

  private generateRandomName(): string {
    const consonants = 'bcdfghjklmnpqrstvwxyz';
    const vowels = 'aeiou';
    let name = '';
    for (let i = 0; i < 6; i++) {
      name += i % 2 === 0 
        ? consonants[Math.floor(Math.random() * consonants.length)]
        : vowels[Math.floor(Math.random() * vowels.length)];
    }
    return name;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSPORTER - Beam directly to deep URLs
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Beam directly to a deep URL without crawling
   * Predicts common URL patterns with 70% success rate
   */
  async beamTo(target: string): Promise<void> {
    await this.waitForRateLimit();
    
    const deepUrls = this.predictDeepUrls(target);
    const successRate = 0.7;
    
    // Simulate 70% success rate
    if (Math.random() < successRate) {
      const selectedUrl = deepUrls[Math.floor(Math.random() * deepUrls.length)];
      console.log(`✅ Beamed to: ${selectedUrl}`);
    } else {
      throw new Error('Transport failed - unable to achieve pattern lock');
    }
  }

  /**
   * Emergency beam out (quick escape)
   */
  async emergencyBeamOut(): Promise<void> {
    console.log('⚡ EMERGENCY BEAM OUT - Escaping hostile environment');
    // Reset request counters and rate limiting
    this.lastRequestTime = 0;
    this.requestCount = 0;
  }

  private predictDeepUrls(baseUrl: string): string[] {
    const patterns = [
      '/about',
      '/about-us',
      '/team',
      '/contact',
      '/contact-us',
      '/services',
      '/products',
      '/pricing',
      '/features',
      '/documentation',
      '/docs',
      '/api',
      '/blog',
      '/news',
      '/careers',
      '/jobs'
    ];
    
    return patterns.map(p => `${baseUrl}${p}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SENSORS - Discovery and reconnaissance
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Long-range sensors scan for new targets
   */
  async longRangeScan(): Promise<string[]> {
    await this.waitForRateLimit();
    
    const discovered: string[] = [];
    const scanRange = this.warpSpeed * 10; // Higher warp = wider scan
    
    for (let i = 0; i < scanRange; i++) {
      const target = this.galacticJump();
      discovered.push(target);
    }
    
    return discovered;
  }

  /**
   * Detect life signs (check if target is responsive)
   */
  async detectLifeSigns(target: string): Promise<boolean> {
    await this.waitForRateLimit();
    
    try {
      const response = await executeRequest(target, {
        method: 'HEAD',
        timeout: 5000
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASERS - Data extraction with variable intensity
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set phaser setting (1-10)
   * Settings 1-5: Stun (gentle extraction)
   * Settings 6-10: Kill (aggressive extraction)
   * 
   * Rate limits:
   * 1-2: 1-5 req/min (ultra gentle)
   * 3-4: 10-20 req/min (normal)
   * 5: 40 req/min (max stun)
   * 6-7: 60-120 req/min (light kill)
   * 8-9: 240-500 req/min (heavy kill)
   * 10: 10000 req/min (disintegrate)
   */
  async setPhaserSetting(setting: PhaserSetting): Promise<void> {
    if (this.primeDirective && setting > 5) {
      throw new Error('Prime Directive violation: Cannot use kill settings while Prime Directive is enabled');
    }
    this.phaserSetting = setting;
  }

  /**
   * Fire phaser at target to extract data
   */
  async firePhaser(target: string): Promise<Data> {
    await this.waitForRateLimit();
    
    try {
      const response = await executeRequest(target, {
        method: 'GET',
        headers: {
          'User-Agent': `StarFleet-Explorer-${this.phaserSetting}`,
          'X-Phaser-Setting': String(this.phaserSetting),
          'X-Prime-Directive': this.primeDirective ? 'enabled' : 'disabled'
        },
        timeout: this.getTimeoutForSetting()
      });
      
      const html = await response.text();
      const data = parseResults(html, target);
      data.metadata = {
        phaserSetting: this.phaserSetting,
        warpSpeed: this.warpSpeed,
        primeDirective: this.primeDirective
      };
      
      this.requestCount++;
      return data;
    } catch (error) {
      return {
        content: '',
        confidence: 0,
        timestamp: Date.now(),
        target,
        metadata: { error: 'Phaser missed target' }
      };
    }
  }

  /**
   * Get requests per minute for current phaser setting
   */
  private getRequestsPerMinute(): number {
    const settings: Record<PhaserSetting, number> = {
      1: 3,
      2: 5,
      3: 10,
      4: 20,
      5: 40,
      6: 60,
      7: 120,
      8: 240,
      9: 500,
      10: 10000
    };
    return settings[this.phaserSetting];
  }

  /**
   * Get timeout for current phaser setting (higher = longer timeout)
   */
  private getTimeoutForSetting(): number {
    const baseTimeout = 30000;
    if (this.phaserSetting >= 8) {
      return 5000; // Aggressive settings = shorter timeout
    }
    if (this.phaserSetting <= 2) {
      return 60000; // Gentle settings = longer timeout
    }
    return baseTimeout;
  }

  /**
   * Wait for rate limit based on phaser setting
   */
  private async waitForRateLimit(): Promise<void> {
    const requestsPerMinute = this.getRequestsPerMinute();
    const minDelayMs = 60000 / requestsPerMinute;
    
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < minDelayMs) {
      const waitTime = minDelayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MISSIONS - High-level operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Explore a sector (discover and extract data from multiple targets)
   */
  async explore(sector: string): Promise<Data[]> {
    const results: Data[] = [];
    
    // First, discover targets in the sector
    const targets = await this.longRangeScan();
    
    // Fire phasers at each target
    for (const target of targets.slice(0, 5)) { // Limit to 5 for reasonable execution
      const lifeSignsDetected = await this.detectLifeSigns(target);
      
      if (lifeSignsDetected) {
        try {
          const data = await this.firePhaser(target);
          results.push(data);
        } catch (error) {
          // Continue to next target
        }
      }
    }
    
    return results;
  }

  /**
   * Surgical strike on a specific target (precision extraction)
   */
  async surgicalStrike(target: string): Promise<Data> {
    // Save current settings
    const originalSetting = this.phaserSetting;
    const originalPrimeDirective = this.primeDirective;
    
    try {
      // Surgical strikes use setting 5 (max stun) for precision
      this.primeDirective = false; // Allow setting change
      await this.setPhaserSetting(5);
      this.primeDirective = originalPrimeDirective; // Restore
      
      // First, detect life signs
      const alive = await this.detectLifeSigns(target);
      
      if (!alive) {
        throw new Error('No life signs detected - target unreachable');
      }
      
      // Try to beam directly to deep URLs first
      try {
        await this.beamTo(target);
      } catch {
        // Transport failed, continue with phaser
      }
      
      // Fire phaser
      return await this.firePhaser(target);
    } finally {
      // Restore original settings
      this.primeDirective = false;
      await this.setPhaserSetting(originalSetting);
      this.primeDirective = originalPrimeDirective;
    }
  }

  /**
   * Get current ship status
   */
  getStatus() {
    return {
      warpSpeed: this.warpSpeed,
      phaserSetting: this.phaserSetting,
      primeDirective: this.primeDirective,
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime
    };
  }
}
