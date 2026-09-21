import { PhylacterySystem } from '../storage/PhylacterySystem';
import { StealthInfrastructure } from '../stealth/StealthInfrastructure';
import { acquirePublicResource } from './PublicAcquisitionInfrastructure';

/**
 * 🦅 BIRD OF PREY CRAWLER
 * Klingon predator optimized for:
 * - Perfect cloaking (complete invisibility)
 * - Fire while cloaked (advanced capability)
 * - Disruptors (50% more powerful than phasers)
 * - Aggressive attack patterns
 * - No ethics/honor code
 */

interface Data { content: string; confidence: number; timestamp: number; target: string; metadata?: any; }
interface RequestOptions { method?: string; headers?: Record<string, string>; body?: any; timeout?: number; }
interface CloakingSignature { userAgent: string; createdAt: number; }

async function executeRequest(url: string, options: RequestOptions, _stealth?: StealthInfrastructure): Promise<Response> {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') throw new Error(`Pantheon crawler network method rejected: ${method}`);
  const result = await acquirePublicResource(url, options.timeout || 30_000, undefined, undefined, {
    method: method as 'GET' | 'HEAD',
    headers: options.headers,
  });
  if (!result.ok) throw new Error(`Crawler request failed: ${result.errorType || 'network_failure'} ${result.status || ''} ${result.error || ''}`.trim());
  return new Response(method === 'HEAD' ? null : result.content, { status: result.status || 200, headers: { 'content-type': result.contentType } });
}

function parseResults(html: string, maxLength = 1000): Data {
  const discoveredCandidates = [...new Set(
    [...html.matchAll(/href=["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(value => /^https?:\/\//i.test(value)),
  )].slice(0, 20);
  return { content: html.replace(/<[^>]*>/g, ' ').substring(0, maxLength), confidence: 0.8, timestamp: Date.now(), target: '', metadata: { discoveredCandidates } };
}

export class BirdOfPreyCrawler {
  private cloaked = false;
  private cloakStrength = 1.0;
  private aggression = 0.95;
  private ethics = 0.01;
  private primeDirective = 0.0;
  private stealth: StealthInfrastructure;
  private phylactery: PhylacterySystem;
  private signatures = new Map<string, CloakingSignature>();
  private killCount = 0;

  constructor(stealth: StealthInfrastructure, phylactery: PhylacterySystem) { this.stealth = stealth; this.phylactery = phylactery; }

  // === CLOAKING DEVICE ===
  async engageCloak(): Promise<void> {
    this.cloaked = true; this.cloakStrength = 1.0;
    this.signatures.set('current', {
      userAgent: this.generateStealthUserAgent(),
      createdAt: Date.now(),
    });
    // Stealth infrastructure will be engaged per-request, not globally
  }

  async perfectCloak(): Promise<void> {
    await this.engageCloak(); this.cloakStrength = 2.0;
    this.signatures.set('quantum', {
      userAgent: this.generateStealthUserAgent(),
      createdAt: Date.now(),
    });
  }

  async disengage(): Promise<void> { this.cloaked = false; this.cloakStrength = 0; this.signatures.clear(); }

  async fireWhileCloaked(): Promise<boolean> {
    if (!this.cloaked) return false;
    const modulationSuccess = this.cloakStrength >= 1.0;
    if (modulationSuccess) this.cloakStrength = Math.max(0.8, this.cloakStrength - 0.1);
    return modulationSuccess;
  }

  private generateStealthUserAgent(): string {
    const agents = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // === DISRUPTORS ===
  async fireDisruptors(target: string, power: number): Promise<Data> {
    if (power < 6 || power > 15) throw new Error('Disruptors only operate at power 6-15 (kill modes only)');
    const phaserPower = power * 10;
    const disruptorPower = phaserPower * 1.5;
    const requestsPerMinute = disruptorPower * 10;
    const detectionRisk = this.cloaked ? 0.05 : 0.15;
    const signature = this.signatures.get(this.cloakStrength >= 2.0 ? 'quantum' : 'current');
    const response = await executeRequest(target, {
      method: 'GET',
      headers: { 'User-Agent': signature?.userAgent || this.generateStealthUserAgent() },
      timeout: 5000
    }, this.stealth);
    const html = await response.text();
    const data = parseResults(html, 1500);
    data.target = target; data.confidence = 0.8 + (power / 100);
    data.metadata = { ...data.metadata, weapon: 'disruptor', power, requestsPerMinute, detectionRisk, cloaked: this.cloaked };
    this.killCount++;
    return data;
  }

  async overloadDisruptors(target: string): Promise<Data> { return this.fireDisruptors(target, 15); }

  async photonTorpedo(target: string): Promise<Data> {
    const power = 15 * 3;
    const signature = this.signatures.get(this.cloakStrength >= 2.0 ? 'quantum' : 'current');
    const response = await executeRequest(target, {
      method: 'GET',
      headers: { 'User-Agent': signature?.userAgent || this.generateStealthUserAgent() },
      timeout: 10000
    }, this.stealth);
    const html = await response.text();
    const data = parseResults(html, 3000);
    data.target = target; data.confidence = 0.95;
    data.metadata = { ...data.metadata, weapon: 'photon-torpedo', power, yield: 'maximum', cloaked: this.cloaked };
    this.killCount++;
    return data;
  }

  // === ATTACK PATTERNS ===
  async decloakStrike(target: string): Promise<Data> {
    await this.engageCloak();
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.disengage();
    const data = await this.fireDisruptors(target, 10);
    await this.engageCloak();
    await new Promise(resolve => setTimeout(resolve, 300));
    data.metadata = { ...data.metadata, attackPattern: 'decloak-strike', steps: ['approach', 'decloak', 'fire', 're-cloak', 'escape'] };
    return data;
  }

  async ghostStrike(target: string): Promise<Data> {
    await this.perfectCloak();
    const canFire = await this.fireWhileCloaked();
    if (!canFire) throw new Error('Ghost strike failed: cannot fire while cloaked');
    const data = await this.fireDisruptors(target, 12);
    data.metadata = { ...data.metadata, attackPattern: 'ghost-strike', remainedCloaked: true, detectionProbability: 0.01 };
    return data;
  }

  async alphaStrike(targets: string[]): Promise<Data[]> {
    await this.perfectCloak();
    const results: Data[] = [];
    const attacks: Promise<Data>[] = [];
    for (const target of targets) {
      attacks.push(this.fireDisruptors(target, 13).catch(() => ({ content: '', confidence: 0, timestamp: Date.now(), target, metadata: { failed: true } })));
    }
    const settled = await Promise.allSettled(attacks);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        result.value.metadata = { ...result.value.metadata, attackPattern: 'alpha-strike', totalTargets: targets.length };
        results.push(result.value);
      }
    }
    return results;
  }

  async hunt(prey: string): Promise<Data> {
    // BirdOfPrey is a URL acquisition crawler, not a search-query engine.
    // Never pass free-form discovery expressions into fetch()/StealthInfrastructure.
    let parsed: URL;
    try {
      parsed = new URL(prey);
    } catch {
      return {
        content: '',
        confidence: 0,
        timestamp: Date.now(),
        target: prey,
        metadata: { skipped: true, reason: 'discovery_query_requires_url_resolution' },
      };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        content: '',
        confidence: 0,
        timestamp: Date.now(),
        target: prey,
        metadata: { skipped: true, reason: 'unsupported_url_protocol' },
      };
    }
    // Production retrieval is a single lawful public GET. The previous route
    // sent three vulnerability-style HEAD probes and then a fourth request;
    // those probes added latency and were not evidence collection.
    const response = await executeRequest(prey, {
      method: 'GET',
      headers: { 'User-Agent': 'LegalWhat-Pantheon-BirdOfPrey/1.0 public-record research' },
      timeout: 10_000,
    }, this.stealth);
    const html = await response.text();
    const data = parseResults(html, 3_000);
    data.target = prey;
    data.confidence = 0.85;
    data.metadata = {
      ...(data.metadata || {}),
      retrievalMode: 'single-lawful-public-get',
      probesPerformed: 0,
    };
    return data;
  }

  // === STATUS ===
  getStatus() { return { cloaked: this.cloaked, cloakStrength: this.cloakStrength, aggression: this.aggression, ethics: this.ethics, primeDirective: this.primeDirective, killCount: this.killCount, signatures: this.signatures.size }; }
  getCombatReadiness(): number {
    let readiness = 0.5;
    if (this.cloaked) readiness += 0.3;
    if (this.cloakStrength >= 2.0) readiness += 0.2;
    return Math.min(readiness, 1.0);
  }
}
