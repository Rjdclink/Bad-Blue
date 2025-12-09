import { ProxyConfiguration } from 'apify';
import * as ProxyChain from 'proxy-chain';

interface ProxyChainConfig {
  apifyToken?: string;
  useApifyProxy?: boolean;
  customProxies?: string[];
  rotationMode?: 'round-robin' | 'random' | 'session-based';
  sessionPersistence?: number;
}

interface ProxySession {
  proxyUrl: string;
  sessionId: string;
  createdAt: Date;
  requestCount: number;
}

export class ProxyChainManager {
  private config: ProxyChainConfig;
  private proxyConfiguration?: ProxyConfiguration;
  private activeSessions = new Map<string, ProxySession>();
  private anonymousProxyServer?: ProxyChain.Server;

  constructor(config: ProxyChainConfig = {}) {
    this.config = {
      rotationMode: config.rotationMode || 'session-based',
      sessionPersistence: config.sessionPersistence || 100,
      useApifyProxy: config.useApifyProxy || false,
      apifyToken: config.apifyToken || process.env.APIFY_TOKEN,
      customProxies: config.customProxies || [],
    };
  }

  async initialize() {
    // Initialize Apify proxy if token provided
    if (this.config.useApifyProxy && this.config.apifyToken) {
      this.proxyConfiguration = new ProxyConfiguration({
        proxyUrls: this.config.customProxies,
        groups: ['RESIDENTIAL', 'DATACENTER'],
      });
      console.log('[ProxyChainManager] Apify proxy initialized');
    }

    // Start anonymous proxy server (dynamic stealth mode)
    this.anonymousProxyServer = new ProxyChain.Server({
      port: 0, // Random port
      prepareRequestFunction: ({ request, username, password, hostname, port, isHttp }) => {
        // Dynamic stealth: get next proxy for rotation
        const upstreamProxyUrl = this.getNextProxy();
        
        return {
          requestAuthentication: false,
          upstreamProxyUrl: upstreamProxyUrl || undefined,
        };
      },
    });

    await this.anonymousProxyServer.listen();
    console.log(`[ProxyChainManager] Anonymous proxy server on port ${this.anonymousProxyServer.port}`);
  }

  private hasAvailableProxies(): boolean {
    return !!(this.config.customProxies && this.config.customProxies.length > 0);
  }

  private getNextProxy(): string | undefined {
    const { customProxies, rotationMode } = this.config;

    if (!this.hasAvailableProxies()) {
      return undefined; // Direct connection
    }

    switch (rotationMode) {
      case 'round-robin':
        return customProxies![Math.floor(Date.now() / 1000) % customProxies!.length];
      
      case 'random':
        return customProxies![Math.floor(Math.random() * customProxies!.length)];
      
      case 'session-based':
        return this.getSessionProxy();
      
      default:
        return customProxies![0];
    }
  }

  private getSessionProxy(): string | undefined {
    // Check if we have proxies to use
    if (!this.hasAvailableProxies()) {
      return undefined;
    }

    const sessionId = this.generateSessionId();
    let session = this.activeSessions.get(sessionId);
    const customProxies = this.config.customProxies!; // Safe: hasAvailableProxies() verified this exists

    if (!session || session.requestCount >= (this.config.sessionPersistence ?? 100)) {
      // Create new session
      const proxyUrl = customProxies[
        Math.floor(Math.random() * customProxies.length)
      ];
      
      session = {
        proxyUrl,
        sessionId,
        createdAt: new Date(),
        requestCount: 0,
      };
      
      this.activeSessions.set(sessionId, session);
    }

    session.requestCount++;
    return session.proxyUrl;
  }

  private generateSessionId(): string {
    // Generate session ID based on 5-minute time window
    // This ensures sessions rotate approximately every 5 minutes
    const timeWindowMs = 5 * 60 * 1000; // 5 minutes
    const timeWindow = Math.floor(Date.now() / timeWindowMs);
    return `session-${timeWindow}`;
  }

  async getStealthProxyUrl(): Promise<string> {
    if (!this.anonymousProxyServer) {
      await this.initialize();
    }

    if (!this.anonymousProxyServer) {
      throw new Error('Failed to initialize proxy server');
    }

    return `http://127.0.0.1:${this.anonymousProxyServer.port}`;
  }

  async getApifyProxy(sessionId?: string): Promise<string | undefined> {
    if (!this.proxyConfiguration) return undefined;

    const proxyInfo = await this.proxyConfiguration.newUrl(sessionId);
    return proxyInfo;
  }

  async close() {
    if (this.anonymousProxyServer) {
      await this.anonymousProxyServer.close(true);
      console.log('[ProxyChainManager] Proxy server closed');
    }
    this.activeSessions.clear();
  }

  getStats() {
    return {
      activeSessions: this.activeSessions.size,
      rotationMode: this.config.rotationMode,
      apifyEnabled: this.config.useApifyProxy,
      proxyCount: this.config.customProxies?.length || 0,
    };
  }
}

export const proxyChainManager = new ProxyChainManager();
