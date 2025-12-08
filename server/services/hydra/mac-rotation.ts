import { MACRotationResult, IPQualityScore } from './types';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

export class MACRotationEngine {
  private ipQualityMap: Map<string, IPQualityScore> = new Map();
  private activeMacs: Set<string> = new Set();
  private running = false;

  constructor() {
    console.log('[MACRotation] Created (inactive)');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[MACRotation] ✓ Started');
  }

  stop(): void {
    this.running = false;
    console.log('[MACRotation] ✓ Stopped');
  }

  generateMAC(): string {
    const bytes = crypto.randomBytes(6);
    bytes[0] = (bytes[0] & 0xfe) | 0x02;
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
  }

  async rotateMAC(interfaceName: string, targetSubnet?: string): Promise<MACRotationResult> {
    if (!this.running) return { success: false, oldMac: '', newMac: '', error: 'Engine not running' };

    const oldMac = await this.getCurrentMAC(interfaceName);
    const newMac = this.generateMAC();

    try {
      if (process.env.HYDRA_SIMULATION === 'true') {
        this.activeMacs.delete(oldMac);
        this.activeMacs.add(newMac);
        const latency = Math.floor(Math.random() * 50) + 10;
        return { success: true, oldMac, newMac, newIp: this.generateSimIP(targetSubnet), latencyMs: latency };
      }

      await execAsync(`ip link set ${interfaceName} down`);
      await execAsync(`ip link set ${interfaceName} address ${newMac}`);
      await execAsync(`ip link set ${interfaceName} up`);
      await execAsync(`dhclient -r ${interfaceName} && dhclient ${interfaceName}`);

      const newIp = await this.getCurrentIP(interfaceName);
      const latency = await this.measureLatency(newIp);

      this.activeMacs.delete(oldMac);
      this.activeMacs.add(newMac);
      this.updateIPQuality(newIp, latency);

      return { success: true, oldMac, newMac, newIp, latencyMs: latency };
    } catch (error: any) {
      return { success: false, oldMac, newMac, error: error.message };
    }
  }

  private async getCurrentMAC(iface: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`cat /sys/class/net/${iface}/address`);
      return stdout.trim();
    } catch {
      return '00:00:00:00:00:00';
    }
  }

  private async getCurrentIP(iface: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`ip -4 addr show ${iface} | grep inet | awk '{print $2}' | cut -d/ -f1`);
      return stdout.trim();
    } catch {
      return '0.0.0.0';
    }
  }

  private async measureLatency(ip: string): Promise<number> {
    const start = Date.now();
    try {
      await execAsync(`ping -c 1 -W 1 8.8.8.8`);
      return Date.now() - start;
    } catch {
      return 9999;
    }
  }

  private generateSimIP(subnet?: string): string {
    const base = subnet || '10.0.0';
    return `${base}.${Math.floor(Math.random() * 254) + 1}`;
  }

  private updateIPQuality(ip: string, latency: number): void {
    const subnet = ip.split('.').slice(0, 3).join('.');
    const existing = this.ipQualityMap.get(ip) || {
      ip, subnet, latencyMap: {}, successRate: 1, lastUsed: 0, cooldownUntil: 0, detectionEvents: 0
    };
    existing.latencyMap['default'] = latency;
    existing.lastUsed = Date.now();
    this.ipQualityMap.set(ip, existing);
  }

  getIPQualityMap(): Map<string, IPQualityScore> {
    return this.ipQualityMap;
  }

  getBestSubnetFor(targetLatency: number): string | null {
    let best: string | null = null;
    let bestScore = Infinity;
    this.ipQualityMap.forEach((score, ip) => {
      const avg = Object.values(score.latencyMap).reduce((a, b) => a + b, 0) / Object.keys(score.latencyMap).length;
      if (avg < bestScore && score.cooldownUntil < Date.now()) {
        bestScore = avg;
        best = score.subnet;
      }
    });
    return best;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const macRotation = new MACRotationEngine();
