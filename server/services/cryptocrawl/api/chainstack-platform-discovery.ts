import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from './blockchain-providers.js';

interface ChainstackNodeV2 {
  id: string;
  name?: string;
  network?: string;
  protocol?: string;
  project?: string;
  cloud?: string;
  region?: string;
  provider?: string;
  status?: string;
  blockchain?: string;
  details?: {
    https_endpoint?: string;
    wss_endpoint?: string;
    api_namespaces?: string[];
  };
}
interface ChainstackPage { count?: number; next?: string | null; results?: ChainstackNodeV2[]; }
export interface ChainstackDiscoveryResult {
  configured: boolean;
  discovered: number;
  registered: number;
  rejected: number;
  nodes: Array<{ nodeId: string; chain: SupportedChain; status: string; httpHost: string; hasWebSocket: boolean }>;
  observedAt: number;
}

const API_BASE = 'https://api.chainstack.com';
const MAX_PAGES = 20;
const PROTOCOL_MAP: Record<string, SupportedChain> = {
  ethereum: 'ethereum', eth: 'ethereum', polygon: 'polygon', 'polygon-pos': 'polygon',
  arbitrum: 'arbitrum', 'arbitrum-one': 'arbitrum', optimism: 'optimism', base: 'base',
  avalanche: 'avalanche', 'avalanche-c': 'avalanche', bsc: 'bsc', 'bnb-smart-chain': 'bsc', binance: 'bsc',
};

function platformKey(): string | null {
  return process.env.CHAINSTACK_PLATFORM_API_KEY?.trim() || null;
}
function sanitizeHost(raw: string): string {
  try { return new URL(raw).host; } catch { return 'invalid'; }
}
function chainFor(node: ChainstackNodeV2): SupportedChain | null {
  if ((node.network || '').trim().toLowerCase() !== 'mainnet') return null;
  return PROTOCOL_MAP[(node.protocol || '').trim().toLowerCase()] || null;
}
async function fetchPage(url: string, key: string): Promise<ChainstackPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(process.env.CHAINSTACK_PLATFORM_TIMEOUT_MS || 8_000)));
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Chainstack Platform API HTTP ${response.status}`);
    return await response.json() as ChainstackPage;
  } finally { clearTimeout(timer); }
}
async function listNodes(key: string): Promise<ChainstackNodeV2[]> {
  const nodes: ChainstackNodeV2[] = [];
  let url: string | null = `${API_BASE}/v2/nodes/`;
  let page = 0;
  while (url && page++ < MAX_PAGES) {
    const payload = await fetchPage(url, key);
    nodes.push(...(Array.isArray(payload.results) ? payload.results : []));
    if (!payload.next) break;
    const next = new URL(payload.next, API_BASE);
    if (next.origin !== API_BASE) throw new Error('Chainstack pagination attempted to leave api.chainstack.com');
    url = next.toString();
  }
  return nodes;
}
async function persistSanitizedInventory(result: ChainstackDiscoveryResult): Promise<void> {
  const payload = {
    configured: result.configured,
    discovered: result.discovered,
    registered: result.registered,
    rejected: result.rejected,
    nodes: result.nodes,
    providerSecretsPersisted: false,
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  await pool.query(
    `insert into private.cryptara_state_snapshots (
      snapshot_id, snapshot_kind, observed_at, schema_version, model_version, config_version,
      provenance, source_event_ids, payload
    ) values ($1,'chainstack_provider_inventory',$2,'chainstack-inventory-v1','provider-discovery-v1',$3,$4,$5,$6::jsonb)
    on conflict (snapshot_id) do nothing`,
    [`chainstack-inventory:${Math.floor(result.observedAt / 3_600_000)}:${digest}`, new Date(result.observedAt),
     process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim() || 'runtime-config-v1',
     ['chainstack_platform_api_v2','sanitized_metadata_only'], [], JSON.stringify(payload)],
  );
}

export async function reconcileChainstackProviderInventory(): Promise<ChainstackDiscoveryResult> {
  const key = platformKey();
  if (!key) return { configured: false, discovered: 0, registered: 0, rejected: 0, nodes: [], observedAt: Date.now() };
  const rawNodes = await listNodes(key);
  let registered = 0;
  let rejected = 0;
  const nodes: ChainstackDiscoveryResult['nodes'] = [];
  for (const node of rawNodes) {
    const chain = chainFor(node);
    const httpUrl = node.details?.https_endpoint?.trim();
    const websocketUrl = node.details?.wss_endpoint?.trim();
    if (!chain || !httpUrl || node.status !== 'running') { rejected++; continue; }
    try {
      await multiProviderRpcManager.registerProvider({
        provider: `chainstack:${node.id}`,
        chain,
        httpUrl,
        websocketUrl: websocketUrl || undefined,
        priority: 8,
        capabilities: ['json_rpc','network','blocks','transactions','receipts','gas','logs','contract_calls', ...(websocketUrl ? ['subscriptions' as const] : [])],
      });
      // registerProvider probes chain identity before the node becomes healthy.
      registered++;
      nodes.push({ nodeId: node.id, chain, status: node.status || 'unknown', httpHost: sanitizeHost(httpUrl), hasWebSocket: Boolean(websocketUrl) });
    } catch (error) {
      rejected++;
      logger.warn('[Chainstack] discovered node rejected by RPC validation', {
        component: 'ChainstackPlatformDiscovery', nodeId: node.id, chain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const result = { configured: true, discovered: rawNodes.length, registered, rejected, nodes, observedAt: Date.now() };
  void persistSanitizedInventory(result).catch(error => logger.warn('[Chainstack] sanitized inventory persistence degraded', {
    component: 'ChainstackPlatformDiscovery', error: error instanceof Error ? error.message : String(error), executionBlocked: false,
  }));
  return result;
}

export async function explicitlyProvisionChainstackNode(request: {
  name: string; project: string; cloud: string; blockchain: string; approvedBudgetTag: string; approval: string;
}): Promise<ChainstackNodeV2> {
  if (process.env.CHAINSTACK_NODE_PROVISIONING_ENABLED !== 'true') throw new Error('Chainstack paid node provisioning is disabled');
  if (request.approval !== 'I_APPROVE_PAID_CHAINSTACK_NODE_PROVISIONING') throw new Error('Explicit paid provisioning approval is required');
  if (!request.approvedBudgetTag.trim()) throw new Error('Governed provisioning requires an approved budget tag');
  const key = platformKey();
  if (!key) throw new Error('CHAINSTACK_PLATFORM_API_KEY is not configured');
  const response = await fetch(`${API_BASE}/v2/nodes/`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ name: request.name, project: request.project, cloud: request.cloud, blockchain: request.blockchain }),
  });
  if (!response.ok) throw new Error(`Chainstack node provisioning HTTP ${response.status}`);
  return await response.json() as ChainstackNodeV2;
}

export const CHAINSTACK_RUNTIME_AUTO_PROVISIONING = false as const;
