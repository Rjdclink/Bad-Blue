import { PhylacterySystem } from '../storage/PhylacterySystem';
import { StealthInfrastructure } from '../stealth/StealthInfrastructure';

/**
 * 🌐 SIX DEGREES CRAWLER
 * 
 * Every website connected through ~6 relationships
 * Maps social graph to find hidden targets
 * 
 * Capabilities:
 * - Build relationship graph
 * - Find shortest path between any 2 sites
 * - Discover communities/clusters
 * - Identify hubs (highly connected nodes)
 * - Path-based crawling
 */

interface Node {
  domain: string;
  connections: string[];
  type: string;
  authority: number;
}

interface Edge {
  from: string;
  to: string;
  type: 'link' | 'backlink' | 'partner' | 'social';
  strength: number;
}

interface Path {
  nodes: string[];
  degrees: number;
  relationships: Edge[];
}

interface Community {
  id: string;
  members: string[];
  commonality: string;
  density: number;
}

interface Data {
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

// Utility functions
async function executeRequest(url: string, options: RequestOptions, stealth?: StealthInfrastructure): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    if (stealth) await stealth.connect(url, 'medium');
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseResults(html: string, maxLength = 1000): Data {
  return {
    content: html.replace(/<[^>]*>/g, ' ').substring(0, maxLength),
    confidence: 0.8,
    timestamp: Date.now(),
    target: ''
  };
}

export class SixDegreesCrawler {
  private graph: Map<string, Node> = new Map();
  private edges: Map<string, Edge[]> = new Map();
  private stealth: StealthInfrastructure;
  private phylactery: PhylacterySystem;

  constructor(stealth: StealthInfrastructure, phylactery: PhylacterySystem) {
    this.stealth = stealth;
    this.phylactery = phylactery;
  }

  // === GRAPH BUILDING ===
  // Map connections up to 6 degrees
  async buildGraph(seed: string, maxDegrees: number = 6): Promise<void> {
    // Validate maxDegrees to prevent infinite loops or unexpected behavior
    if (maxDegrees < 1 || maxDegrees > 10) {
      throw new Error('maxDegrees must be between 1 and 10');
    }

    const visited = new Set<string>();
    const queue: Array<{ domain: string; degree: number }> = [{ domain: seed, degree: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.domain) || current.degree >= maxDegrees) {
        continue;
      }

      visited.add(current.domain);

      // Create or update node
      if (!this.graph.has(current.domain)) {
        this.graph.set(current.domain, {
          domain: current.domain,
          connections: [],
          type: 'website',
          authority: this.calculateAuthority(current.domain)
        });
      }

      // Discover connections
      try {
        const connections = await this.discoverConnections(current.domain);
        
        // Store edges
        this.edges.set(current.domain, connections);

        // Update node connections and add to queue
        const node = this.graph.get(current.domain)!;
        for (const edge of connections) {
          if (!node.connections.includes(edge.to)) {
            node.connections.push(edge.to);
          }
          
          // Add to queue for next degree
          if (!visited.has(edge.to)) {
            queue.push({ domain: edge.to, degree: current.degree + 1 });
          }
        }
      } catch (error) {
        // Continue on error
        console.error(`Failed to discover connections for ${current.domain}:`, error);
      }
    }
  }

  // Helper: construct safe URL from domain
  private constructUrl(domain: string): string {
    // Validate and sanitize domain
    if (!domain || typeof domain !== 'string') {
      throw new Error('Invalid domain');
    }

    // Remove any whitespace or control characters
    const sanitized = domain.trim();
    
    // If already a valid URL, validate and return
    if (sanitized.startsWith('http://') || sanitized.startsWith('https://')) {
      try {
        const url = new URL(sanitized);
        return url.toString();
      } catch {
        throw new Error('Invalid URL format');
      }
    }

    // Construct URL from domain
    try {
      const url = new URL(`https://${sanitized}`);
      return url.toString();
    } catch {
      throw new Error('Invalid domain format');
    }
  }

  // Discover connections for a domain
  private async discoverConnections(domain: string): Promise<Edge[]> {
    const edges: Edge[] = [];

    try {
      // Fetch domain content with validated URL
      const response = await executeRequest(
        this.constructUrl(domain),
        {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SixDegreesBot/1.0)' },
          timeout: 10000
        },
        this.stealth
      );

      const html = await response.text();

      // Extract links with proper validation
      const linkMatches = html.match(/https?:\/\/[^\s<>"']+/g) || [];
      const uniqueLinks = [...new Set(linkMatches)];

      // Create edges for discovered links with validation
      for (const link of uniqueLinks.slice(0, 20)) {
        try {
          // Validate URL before processing
          new URL(link);
          const linkDomain = this.extractDomain(link);
          if (linkDomain && linkDomain !== domain) {
            edges.push({
              from: domain,
              to: linkDomain,
              type: 'link',
              strength: 1.0
            });
          }
        } catch {
          // Skip invalid URLs
          continue;
        }
      }

      // Detect partner/social relationships
      const socialPlatforms = ['twitter.com', 'facebook.com', 'linkedin.com', 'instagram.com'];
      const businessIndicators = ['partner', 'affiliate', 'network'];

      for (const edge of edges) {
        // Social connections
        if (socialPlatforms.some(platform => edge.to.includes(platform))) {
          edge.type = 'social';
          edge.strength = 0.7;
        }
        
        // Business relationships
        if (businessIndicators.some(indicator => html.toLowerCase().includes(indicator))) {
          edge.type = 'partner';
          edge.strength = 0.85;
        }
      }
    } catch (error) {
      // Return empty array on error
      console.error(`Failed to fetch ${domain}:`, error);
    }

    return edges;
  }

  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  private calculateAuthority(domain: string): number {
    // Simple authority calculation based on domain characteristics
    let authority = 0.5;
    
    // Common TLDs have higher authority
    if (domain.endsWith('.gov') || domain.endsWith('.edu')) {
      authority = 0.9;
    } else if (domain.endsWith('.org')) {
      authority = 0.7;
    } else if (domain.endsWith('.com')) {
      authority = 0.6;
    }

    // Well-known domains
    const wellKnown = ['google', 'facebook', 'twitter', 'linkedin', 'wikipedia'];
    if (wellKnown.some(known => domain.includes(known))) {
      authority = Math.max(authority, 0.95);
    }

    return authority;
  }

  // === PATH FINDING ===
  // Find shortest path between source and target
  async findPath(source: string, target: string): Promise<Path> {
    const queue: Array<{ domain: string; path: string[]; edges: Edge[] }> = [
      { domain: source, path: [source], edges: [] }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      if (current.domain === target) {
        return {
          nodes: current.path,
          degrees: current.path.length - 1,
          relationships: current.edges
        };
      }

      if (visited.has(current.domain)) {
        continue;
      }
      visited.add(current.domain);

      // Get connections
      const edges = this.edges.get(current.domain) || [];
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          queue.push({
            domain: edge.to,
            path: [...current.path, edge.to],
            edges: [...current.edges, edge]
          });
        }
      }
    }

    // No path found
    return { nodes: [], degrees: -1, relationships: [] };
  }

  // Find all paths within N degrees
  async findAllPaths(source: string, target: string, maxDegrees: number): Promise<Path[]> {
    const allPaths: Path[] = [];

    const dfs = (
      current: string,
      path: string[],
      edges: Edge[],
      visited: Set<string>
    ): void => {
      if (path.length - 1 > maxDegrees) {
        return;
      }

      if (current === target) {
        allPaths.push({
          nodes: [...path],
          degrees: path.length - 1,
          relationships: [...edges]
        });
        return;
      }

      visited.add(current);

      const currentEdges = this.edges.get(current) || [];
      for (const edge of currentEdges) {
        if (!visited.has(edge.to)) {
          dfs(edge.to, [...path, edge.to], [...edges, edge], new Set(visited));
        }
      }
    };

    dfs(source, [source], [], new Set());
    return allPaths;
  }

  // === COMMUNITY DETECTION ===
  // Find clusters of related sites
  async findCommunities(): Promise<Community[]> {
    const communities: Community[] = [];
    const visited = new Set<string>();

    for (const [domain, node] of this.graph) {
      if (visited.has(domain)) continue;

      // Start new community
      const members: string[] = [domain];
      const communitySet = new Set<string>([domain]);
      visited.add(domain);

      // BFS to find densely connected nodes
      const queue: string[] = [domain];
      
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;

        const edges = this.edges.get(current) || [];
        
        for (const edge of edges) {
          if (!visited.has(edge.to) && edge.strength >= 0.7) {
            // Check if target has strong connections back to community
            const targetEdges = this.edges.get(edge.to) || [];
            const backConnections = targetEdges.filter(e => 
              communitySet.has(e.to) && e.strength >= 0.7
            ).length;

            // High internal connectivity
            if (backConnections >= 2 || (members.length < 3 && backConnections >= 1)) {
              members.push(edge.to);
              communitySet.add(edge.to);
              visited.add(edge.to);
              queue.push(edge.to);
            }
          }
        }
      }

      // Only create community if it has multiple members
      if (members.length >= 2) {
        const density = this.calculateDensity(members);
        const commonality = this.findCommonality(members);

        communities.push({
          id: `community-${communities.length + 1}`,
          members,
          commonality,
          density
        });
      }
    }

    return communities;
  }

  private calculateDensity(members: string[]): number {
    if (members.length < 2) return 0;

    let totalEdges = 0;
    let possibleEdges = 0;

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        possibleEdges++;
        const edges = this.edges.get(members[i]) || [];
        if (edges.some(e => e.to === members[j])) {
          totalEdges++;
        }
      }
    }

    return possibleEdges > 0 ? totalEdges / possibleEdges : 0;
  }

  private findCommonality(members: string[]): string {
    // Simple commonality detection
    const tlds = members.map(m => m.split('.').pop() || '');
    const tldCounts = new Map<string, number>();
    
    for (const tld of tlds) {
      tldCounts.set(tld, (tldCounts.get(tld) || 0) + 1);
    }

    const mostCommon = [...tldCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mostCommon && mostCommon[1] > 1) {
      return `${mostCommon[0]} domain group`;
    }

    return 'related websites';
  }

  // === HUB IDENTIFICATION ===
  // Find most connected nodes
  async findHubs(limit: number = 10): Promise<Node[]> {
    const nodes = Array.from(this.graph.values());
    
    // Sort by connection count
    nodes.sort((a, b) => b.connections.length - a.connections.length);
    
    return nodes.slice(0, limit);
  }

  // === DISCOVERY ===
  // Discover hidden sites via graph traversal
  async discoverHidden(knownSite: string): Promise<string[]> {
    const hidden: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ domain: string; degree: number }> = [
      { domain: knownSite, degree: 0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.domain) || current.degree >= 6) {
        continue;
      }

      visited.add(current.domain);

      const node = this.graph.get(current.domain);
      if (node) {
        // Hidden = low authority and not well-known
        if (node.authority < 0.4 && current.degree > 0) {
          hidden.push(node.domain);
        }

        // Add connections to queue
        for (const connection of node.connections) {
          if (!visited.has(connection)) {
            queue.push({ domain: connection, degree: current.degree + 1 });
          }
        }
      }
    }

    return hidden;
  }

  // === CRAWLING STRATEGIES ===
  // Crawl along path from source to target
  async crawlPath(source: string, target: string): Promise<Data[]> {
    const path = await this.findPath(source, target);
    const data: Data[] = [];
    
    for (const node of path.nodes) {
      try {
        const result = await this.scrape(node);
        data.push(result);
      } catch (error) {
        console.error(`Failed to scrape ${node}:`, error);
      }
    }
    
    return data;
  }

  // Crawl entire community
  async crawlCommunity(community: Community): Promise<Data[]> {
    const data: Data[] = [];
    
    for (const member of community.members) {
      try {
        const result = await this.scrape(member);
        data.push(result);
      } catch (error) {
        console.error(`Failed to scrape ${member}:`, error);
      }
    }
    
    return data;
  }

  // Exploit hub to reach all connected nodes
  async exploitHub(hub: string): Promise<Data[]> {
    const node = this.graph.get(hub);
    if (!node) {
      return [];
    }

    const data: Data[] = [];
    
    // Scrape hub first
    try {
      const hubData = await this.scrape(hub);
      data.push(hubData);
    } catch (error) {
      console.error(`Failed to scrape hub ${hub}:`, error);
    }

    // Hub gives access to all connections
    for (const neighbor of node.connections) {
      try {
        const result = await this.scrape(neighbor);
        data.push(result);
      } catch (error) {
        console.error(`Failed to scrape ${neighbor}:`, error);
      }
    }

    return data;
  }

  // Helper: scrape a single domain
  private async scrape(domain: string): Promise<Data> {
    try {
      // Use helper method for consistent URL construction
      const url = this.constructUrl(domain);
      
      const response = await executeRequest(
        url,
        {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SixDegreesBot/1.0)' },
          timeout: 10000
        },
        this.stealth
      );

      const html = await response.text();
      const data = parseResults(html, 5000);
      data.target = domain;
      
      return data;
    } catch (error) {
      return {
        content: '',
        confidence: 0,
        timestamp: Date.now(),
        target: domain,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  // === UTILITY ===
  getGraphStats() {
    return {
      nodeCount: this.graph.size,
      edgeCount: Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0),
      avgConnections: this.graph.size > 0 
        ? Array.from(this.graph.values()).reduce((sum, node) => sum + node.connections.length, 0) / this.graph.size 
        : 0
    };
  }

  /**
   * Map connections for a target domain
   * Alias method for compatibility with PantheonCrawlerOrchestrator
   */
  async mapConnections(target: string, depth: number = 2): Promise<{ nodes: Node[]; edges: Edge[] }> {
    await this.buildGraph(target, depth);
    return {
      nodes: Array.from(this.graph.values()),
      edges: Array.from(this.edges.values()).flat()
    };
  }

  clearGraph() {
    this.graph.clear();
    this.edges.clear();
  }
}
