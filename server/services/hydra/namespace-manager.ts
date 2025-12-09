import { NetworkNamespace, NamespaceCreateResult, HydraConfig, DEFAULT_HYDRA_CONFIG } from './types';
import { macRotation } from './mac-rotation';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

export class NamespaceManager {
  private namespaces: Map<string, NetworkNamespace> = new Map();
  private config: HydraConfig = DEFAULT_HYDRA_CONFIG;
  private running = false;
  private recycleInterval: NodeJS.Timeout | null = null;
  private startedMacRotation = false;

  constructor() {
    console.log('[NamespaceManager] Created (inactive)');
  }

  private validateNamespaceId(id: string): boolean {
    return /^hydra-ns-[0-9a-f]{8}$/.test(id);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (!macRotation.isRunning()) {
      macRotation.start();
      this.startedMacRotation = true;
    }
    this.recycleInterval = setInterval(() => this.recycleStaleNamespaces(), this.config.namespaceRecycleMs);
    console.log('[NamespaceManager] ✓ Started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.startedMacRotation) {
      macRotation.stop();
      this.startedMacRotation = false;
    }
    if (this.recycleInterval) clearInterval(this.recycleInterval);
    await this.destroyAllNamespaces();
    console.log('[NamespaceManager] ✓ Stopped');
  }

  async createNamespace(preferredSubnet?: string): Promise<NamespaceCreateResult> {
    if (!this.running) return { success: false, error: 'Manager not running' };
    if (this.namespaces.size >= this.config.maxNamespaces) {
      const recycled = await this.recycleOldestNamespace();
      if (!recycled && this.namespaces.size >= this.config.maxNamespaces) {
        return { success: false, error: 'Failed to recycle namespace and max limit reached' };
      }
    }

    const id = `hydra-ns-${crypto.randomBytes(4).toString('hex')}`;
    const mac = macRotation.generateMAC();

    try {
      if (process.env.HYDRA_SIMULATION === 'true') {
        const ns: NetworkNamespace = {
          id, mac, ip: `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`,
          subnet: preferredSubnet || '10.0.0', createdAt: Date.now(), latencyMs: Math.floor(Math.random()*50)+10,
          status: 'active', crawlerId: null
        };
        this.namespaces.set(id, ns);
        return { success: true, namespace: ns };
      }

      await execAsync(`ip netns add ${id}`);
      await execAsync(`ip netns exec ${id} ip link set lo up`);
      const veth = `veth-${id.slice(-8)}`;
      const vpeer = `vpeer-${id.slice(-8)}`;
      await execAsync(`ip link add ${veth} type veth peer name ${vpeer}`);
      await execAsync(`ip link set ${vpeer} netns ${id}`);
      await execAsync(`ip netns exec ${id} ip link set ${vpeer} address ${mac}`);
      await execAsync(`ip netns exec ${id} ip link set ${vpeer} up`);
      await execAsync(`ip link set ${veth} up`);

      const ip = `10.200.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`;
      await execAsync(`ip netns exec ${id} ip addr add ${ip}/24 dev ${vpeer}`);

      const ns: NetworkNamespace = {
        id, mac, ip, subnet: ip.split('.').slice(0,3).join('.'),
        createdAt: Date.now(), latencyMs: 0, status: 'active', crawlerId: null
      };
      this.namespaces.set(id, ns);
      return { success: true, namespace: ns };
    } catch (error: any) {
      // Clean up any partially created resources
      if (process.env.HYDRA_SIMULATION !== 'true' && this.validateNamespaceId(id)) {
        try {
          await execAsync(`ip netns del ${id}`).catch(() => {});
          await execAsync(`ip link del veth-${id.slice(-8)}`).catch(() => {});
        } catch {
          // Ignore cleanup errors
        }
      }
      return { success: false, error: error.message };
    }
  }

  async destroyNamespace(id: string): Promise<boolean> {
    const ns = this.namespaces.get(id);
    if (!ns) return false;
    if (!this.validateNamespaceId(id)) return false;

    try {
      if (process.env.HYDRA_SIMULATION !== 'true') {
        await execAsync(`ip netns del ${id}`).catch(() => {});
        await execAsync(`ip link del veth-${id.slice(-8)}`).catch(() => {});
      }
      this.namespaces.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  async cycleNamespace(id: string): Promise<NamespaceCreateResult> {
    const old = this.namespaces.get(id);
    const preferredSubnet = old?.subnet;
    await this.destroyNamespace(id);
    return this.createNamespace(preferredSubnet);
  }

  private async recycleStaleNamespaces(): Promise<void> {
    const now = Date.now();
    for (const [id, ns] of this.namespaces) {
      if (now - ns.createdAt > this.config.namespaceRecycleMs && !ns.crawlerId) {
        await this.destroyNamespace(id);
      }
    }
  }

  private async recycleOldestNamespace(): Promise<boolean> {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, ns] of this.namespaces) {
      if (ns.createdAt < oldestTime && !ns.crawlerId) {
        oldestTime = ns.createdAt;
        oldest = id;
      }
    }
    if (oldest) {
      return await this.destroyNamespace(oldest);
    }
    return false;
  }

  private async destroyAllNamespaces(): Promise<void> {
    for (const id of this.namespaces.keys()) {
      await this.destroyNamespace(id);
    }
  }

  assignCrawler(namespaceId: string, crawlerId: string): boolean {
    const ns = this.namespaces.get(namespaceId);
    if (!ns || ns.crawlerId) return false;
    ns.crawlerId = crawlerId;
    return true;
  }

  releaseCrawler(namespaceId: string): void {
    const ns = this.namespaces.get(namespaceId);
    if (ns) ns.crawlerId = null;
  }

  getAvailableNamespace(): NetworkNamespace | null {
    for (const ns of this.namespaces.values()) {
      if (!ns.crawlerId && ns.status === 'active') return ns;
    }
    return null;
  }

  getNamespace(id: string): NetworkNamespace | undefined {
    return this.namespaces.get(id);
  }

  getAllNamespaces(): NetworkNamespace[] {
    return Array.from(this.namespaces.values());
  }

  getStats(): { total: number; active: number; available: number } {
    let active = 0, available = 0;
    this.namespaces.forEach(ns => {
      if (ns.status === 'active') active++;
      if (!ns.crawlerId) available++;
    });
    return { total: this.namespaces.size, active, available };
  }

  isRunning(): boolean {
    return this.running;
  }

  reset(): void {
    this.namespaces.clear();
    this.running = false;
    this.startedMacRotation = false;
    if (this.recycleInterval) {
      clearInterval(this.recycleInterval);
      this.recycleInterval = null;
    }
  }
}

export const namespaceManager = new NamespaceManager();
