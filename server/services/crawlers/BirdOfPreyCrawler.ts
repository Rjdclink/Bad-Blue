import { PhylacterySystem } from '../storage/PhylacterySystem';
import { StealthInfrastructure } from '../stealth/StealthInfrastructure';

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
interface CloakingSignature { ip: string; fingerprint: string; timing: number[]; userAgent: string; }

async function executeRequest(url: string, options: RequestOptions, stealth?: StealthInfrastructure): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    if (stealth) await stealth.connect(url, 'high');
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { clearTimeout(timeoutId); }
}

function parseResults(html: string, maxLength = 1000): Data {
  return { content: html.replace(/<[^>]*>/g, ' ').substring(0, maxLength), confidence: 0.8, timestamp: Date.now(), target: '' };
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
      ip: this.generateRandomIP(), fingerprint: this.generateFingerprint(),
      timing: this.generateRandomTimings(), userAgent: this.generateStealthUserAgent()
    });
    // Stealth infrastructure will be engaged per-request, not globally
  }

  async perfectCloak(): Promise<void> {
    await this.engageCloak(); this.cloakStrength = 2.0;
    this.signatures.set('quantum', {
      ip: this.generateQuantumIP(), fingerprint: this.generateQuantumFingerprint(),
      timing: this.generateQuantumTimings(), userAgent: this.generateStealthUserAgent()
    });
  }

  async disengage(): Promise<void> { this.cloaked = false; this.cloakStrength = 0; this.signatures.clear(); }

  async fireWhileCloaked(): Promise<boolean> {
    if (!this.cloaked) return false;
    const modulationSuccess = this.cloakStrength >= 1.0;
    if (modulationSuccess) this.cloakStrength = Math.max(0.8, this.cloakStrength - 0.1);
    return modulationSuccess;
  }

  private generateRandomIP(): string { return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`; }
  private generateQuantumIP(): string { return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`; }
  private generateFingerprint(): string { return `klingon-${Math.random().toString(36).substring(2, 15)}`; }
  private generateQuantumFingerprint(): string { return `quantum-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`; }
  private generateRandomTimings(): number[] { return Array(5).fill(0).map(() => 100 + Math.random() * 500); }
  private generateQuantumTimings(): number[] { return Array(10).fill(0).map(() => 50 + Math.random() * 1000); }
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
      headers: { 'User-Agent': signature?.userAgent || this.generateStealthUserAgent(), 'X-Disruptor-Power': power.toString(), 'X-Weapon-Type': 'disruptor', 'X-Cloaked': this.cloaked.toString() },
      timeout: 5000
    }, this.stealth);
    const html = await response.text();
    const data = parseResults(html, 1500);
    data.target = target; data.confidence = 0.8 + (power / 100);
    data.metadata = { weapon: 'disruptor', power, requestsPerMinute, detectionRisk, cloaked: this.cloaked };
    this.killCount++;
    return data;
  }

  async overloadDisruptors(target: string): Promise<Data> { return this.fireDisruptors(target, 15); }

  async photonTorpedo(target: string): Promise<Data> {
    const power = 15 * 3;
    const signature = this.signatures.get(this.cloakStrength >= 2.0 ? 'quantum' : 'current');
    const response = await executeRequest(target, {
      method: 'GET',
      headers: { 'User-Agent': signature?.userAgent || this.generateStealthUserAgent(), 'X-Weapon-Type': 'photon-torpedo', 'X-Weapon-Yield': 'maximum', 'X-Cloaked': this.cloaked.toString() },
      timeout: 10000
    }, this.stealth);
    const html = await response.text();
    const data = parseResults(html, 3000);
    data.target = target; data.confidence = 0.95;
    data.metadata = { weapon: 'photon-torpedo', power, yield: 'maximum', cloaked: this.cloaked };
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
    await this.perfectCloak();
    const reconPasses = 3;
    let vulnerability = 0;
    for (let i = 0; i < reconPasses; i++) {
      try {
        const response = await executeRequest(prey, { method: 'HEAD', headers: { 'User-Agent': this.generateStealthUserAgent() }, timeout: 3000 }, this.stealth);
        if (response.status === 200) vulnerability += 0.3;
        if (!response.headers.get('x-frame-options')) vulnerability += 0.2;
        if (!response.headers.get('x-content-type-options')) vulnerability += 0.2;
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
      } catch { vulnerability -= 0.1; }
    }
    let data: Data;
    if (vulnerability > 0.5) data = await this.photonTorpedo(prey);
    else if (vulnerability > 0.3) data = await this.overloadDisruptors(prey);
    else data = await this.fireDisruptors(prey, 10);
    data.metadata = { ...data.metadata, attackPattern: 'hunt', stalkedFor: reconPasses, vulnerabilityScore: vulnerability, strikeType: vulnerability > 0.5 ? 'photon-torpedo' : vulnerability > 0.3 ? 'overload' : 'standard' };
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
