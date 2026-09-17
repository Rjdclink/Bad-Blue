import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { getHedgedDexQuote } from '../intelligence/dex-quote-provider-mesh.js';
import { ensureGhostWalletBootstrapWork } from './ghost-wallet-bootstrap-work-recovery.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { getGhostWalletPimlicoSupportedChains } from './ghost-wallet-pimlico-sponsor.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const FILLER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-ghost-wallet-uniswapx-filler:v1'));
const DEFAULT_POLL_MS = 1_000;
const MIN_POLL_MS = 750;
const MAX_POLL_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_500;
const ORDER_RECHECK_MS = 4_000;
const MAX_ORDERS_PER_TICK = 4;
const ORDER_TTL_MS = 10 * 60_000;
const DEFAULT_SLIPPAGE_PPM = 3_000;

const CHAIN_IDS: Partial<Record<GhostWalletChain, number>> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
};

const UNISWAPX_REACTORS: Partial<Record<GhostWalletChain, string[]>> = {
  ethereum: [
    '0x00000011F84B9aa48e5f8aA8B9897600006289Be',
    '0x0000000015757c461808EA25Eb309638B62681cf',
    '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4',
  ],
  optimism: ['0x000000000923439A92daE8930613568824108631'],
  bsc: ['0x00000000a55e50C71b70Db3C8B58749cd1E18eB2'],
  polygon: ['0x00000000bAB6E234db8AD638B6A6395b7c499Bc4'],
  base: [
    '0x000000001Ec5656dcdB24D90DFa42742738De729',
    '0x000000008a8330B5d1F43A62Bf4C673A49f27ba0',
  ],
  arbitrum: ['0xB274d5F4b833b61B340b654d600A864fB604a87c'],
  avalanche: ['0x00000000862cCF095823fc7576Fa6C7e6b7385ef'],
};

const ORDER_QUOTERS: Partial<Record<GhostWalletChain, string>> = {
  ethereum: '0x54539967a06Fc0E3C3ED0ee320Eb67362D13C5fF',
  optimism: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
  bsc: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
  polygon: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
  base: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
  arbitrum: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
  avalanche: '0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58',
};

const FILLER_ABI = [
  'function owner() view returns (address)',
  'function profitRecipient() view returns (address)',
  'function executeSignedOrder(address reactor,bytes encodedOrder,bytes signature,(address target,bytes data,address inputToken,address profitToken,uint256 inputAmount,uint256 minProfit) route)',
];

const ORDER_QUOTER_ABI = [{
  inputs: [{ name: 'order', type: 'bytes' }, { name: 'sig', type: 'bytes' }],
  name: 'quote',
  outputs: [{
    name: 'result',
    type: 'tuple',
    components: [
      {
        name: 'info', type: 'tuple', components: [
          { name: 'reactor', type: 'address' },
          { name: 'swapper', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'additionalValidationContract', type: 'address' },
          { name: 'additionalValidationData', type: 'bytes' },
        ],
      },
      {
        name: 'input', type: 'tuple', components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'maxAmount', type: 'uint256' },
        ],
      },
      {
        name: 'outputs', type: 'tuple[]', components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
      { name: 'sig', type: 'bytes' },
      { name: 'hash', type: 'bytes32' },
    ],
  }],
  stateMutability: 'nonpayable',
  type: 'function',
}] as const;

interface FillerArtifact {
  contractName: string;
  bytecode: string;
}

interface PublicOrder {
  type?: unknown;
  encodedOrder?: unknown;
  signature?: unknown;
  orderHash?: unknown;
  orderStatus?: unknown;
  chainId?: unknown;
  reactor?: unknown;
}

interface DemandStatus {
  running: boolean;
  nextChainIndex: number;
  polls: number;
  fetchedOrders: number;
  executableOrders: number;
  queuedOrders: number;
  rejectedOrders: number;
  routeLocalErrors: number;
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  fillerAddresses: Partial<Record<GhostWalletChain, string>>;
}

let artifactPromise: Promise<FillerArtifact> | null = null;

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}

function pollMs(): number {
  return boundedInt(process.env.GHOST_WALLET_UNISWAPX_POLL_MS, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS);
}

function requestTimeoutMs(): number {
  return boundedInt(process.env.GHOST_WALLET_UNISWAPX_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 750, 10_000);
}

function slippagePpm(): number {
  return boundedInt(process.env.GHOST_WALLET_UNISWAPX_SLIPPAGE_PPM, DEFAULT_SLIPPAGE_PPM, 100, 20_000);
}

function enabled(): boolean {
  if (/^(0|false|off|no)$/i.test(String(process.env.GHOST_WALLET_UNISWAPX_ENABLED || 'true'))) return false;
  return /^(1|true|yes|on)$/i.test(String(process.env.GHOST_WALLET_ENABLED || process.env.GHOST_WALLET_LIVE_EXECUTION || ''));
}

function safeAddress(value: unknown): string | null {
  const raw = String(value || '').trim();
  return ethers.utils.isAddress(raw) ? ethers.utils.getAddress(raw) : null;
}

function safeHex(value: unknown): string | null {
  const raw = String(value || '').trim();
  return ethers.utils.isHexString(raw) && raw.length > 2 ? raw : null;
}

function safeHash(value: unknown): string | null {
  const raw = String(value || '').trim();
  return /^0x[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : null;
}

async function artifact(): Promise<FillerArtifact> {
  if (!artifactPromise) {
    artifactPromise = readFile(
      resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlGhostWalletUniswapXFiller.json'),
      'utf8',
    ).then(raw => JSON.parse(raw) as Partial<FillerArtifact>)
      .then(parsed => {
        if (parsed.contractName !== 'CryptocrawlGhostWalletUniswapXFiller'
          || typeof parsed.bytecode !== 'string'
          || !ethers.utils.isHexString(parsed.bytecode)
          || parsed.bytecode === '0x') {
          throw new Error('GHOST_WALLET_UNISWAPX_FILLER_ARTIFACT_INVALID');
        }
        return parsed as FillerArtifact;
      });
  }
  return artifactPromise;
}

function currentReactors(chain: GhostWalletChain): string[] {
  return (UNISWAPX_REACTORS[chain] || []).map(value => ethers.utils.getAddress(value));
}

async function fillerDescriptor(chain: GhostWalletChain): Promise<{
  address: string;
  deployed: boolean;
  deployment: { to: string; data: string; value: '0' } | null;
}> {
  const wallet = ghostWalletEngine.getExecutionWallet(chain);
  if (!wallet) throw new Error(`GHOST_WALLET_UNISWAPX_CONTROLLER_UNAVAILABLE:${chain}`);
  const recipient = resolvePrimaryProfitPayoutAddress();
  if (!recipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
  const reactors = currentReactors(chain);
  if (reactors.length === 0) throw new Error(`GHOST_WALLET_UNISWAPX_REACTOR_UNAVAILABLE:${chain}`);
  const built = await artifact();
  const initCode = ethers.utils.hexConcat([
    built.bytecode,
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address[]'],
      [wallet.address, ethers.utils.getAddress(recipient), reactors],
    ),
  ]);
  const address = ethers.utils.getCreate2Address(CREATE2_DEPLOYER, FILLER_SALT, ethers.utils.keccak256(initCode));

  return ghostWalletProviderMesh.runHedged({
    chain,
    operation: 'ghost_uniswapx_filler_descriptor',
    execute: async provider => {
      const code = await provider.getCode(address);
      if (code !== '0x') {
        const contract = new Contract(address, FILLER_ABI, provider);
        const [actualOwner, actualRecipient] = await Promise.all([contract.owner(), contract.profitRecipient()]);
        if (String(actualOwner).toLowerCase() !== wallet.address.toLowerCase()
          || String(actualRecipient).toLowerCase() !== recipient.toLowerCase()) {
          throw new Error(`GHOST_WALLET_UNISWAPX_FILLER_IDENTITY_MISMATCH:${chain}`);
        }
        return { address, deployed: true, deployment: null };
      }
      const factoryCode = await provider.getCode(CREATE2_DEPLOYER);
      if (factoryCode === '0x'
        || ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
        throw new Error(`GHOST_WALLET_UNISWAPX_CREATE2_FACTORY_NOT_VERIFIED:${chain}`);
      }
      return {
        address,
        deployed: false,
        deployment: {
          to: CREATE2_DEPLOYER,
          data: ethers.utils.hexConcat([FILLER_SALT, initCode]),
          value: '0' as const,
        },
      };
    },
  });
}

async function ensureFiller(chain: GhostWalletChain): Promise<string | null> {
  const descriptor = await fillerDescriptor(chain);
  if (descriptor.deployed) return descriptor.address;
  if (!descriptor.deployment) return null;
  const work = await ensureGhostWalletBootstrapWork({
    dedupeKey: `ghost-uniswapx-filler-bootstrap:${chain}:${descriptor.address.toLowerCase()}`,
    chain,
    priority: 990,
    maxAttempts: 20,
    payload: {
      mode: 'bridge_bootstrap',
      chain,
      to: descriptor.deployment.to,
      data: descriptor.deployment.data,
      value: descriptor.deployment.value,
      verifyCodeAt: descriptor.address,
      infrastructureKind: 'uniswapx_zero_inventory_filler',
    },
  });
  if (work.status === 'QUEUED' || work.status === 'RETRYABLE' || work.rearmed) {
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
  }
  return null;
}

async function fetchOpenOrders(chainId: number): Promise<PublicOrder[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  timer.unref?.();
  try {
    const url = new URL('https://api.uniswap.org/v2/orders');
    url.searchParams.set('orderStatus', 'open');
    url.searchParams.set('chainId', String(chainId));
    url.searchParams.set('limit', '20');
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GHOST_WALLET_UNISWAPX_HTTP_${response.status}`);
    const parsed = await response.json() as { orders?: unknown };
    return Array.isArray(parsed.orders) ? parsed.orders.slice(0, 20) as PublicOrder[] : [];
  } finally {
    clearTimeout(timer);
  }
}

async function resolvedOrder(chain: GhostWalletChain, encodedOrder: string, signature: string): Promise<any> {
  const quoterAddress = ORDER_QUOTERS[chain];
  if (!quoterAddress) throw new Error(`GHOST_WALLET_UNISWAPX_QUOTER_UNAVAILABLE:${chain}`);
  const provider = await ghostWalletProviderMesh.getProvider(chain) || ghostWalletEngine.getProvider(chain);
  if (!provider) throw new Error(`GHOST_WALLET_UNISWAPX_PROVIDER_UNAVAILABLE:${chain}`);
  const quoter = new Contract(quoterAddress, ORDER_QUOTER_ABI as any, provider);
  return quoter.callStatic.quote(encodedOrder, signature);
}

function oneOutputAsset(outputs: any[]): { token: string; required: bigint } | null {
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  let token: string | null = null;
  let required = 0n;
  for (const output of outputs) {
    const address = safeAddress(output?.token);
    if (!address || address === ethers.constants.AddressZero) return null;
    const amount = BigInt(ethers.BigNumber.from(output?.amount ?? 0).toString());
    if (amount <= 0n) return null;
    if (!token) token = address;
    else if (token.toLowerCase() !== address.toLowerCase()) return null;
    required += amount;
  }
  return token && required > 0n ? { token, required } : null;
}

async function qualifyAndQueue(chain: GhostWalletChain, filler: string, order: PublicOrder): Promise<boolean> {
  const chainId = CHAIN_IDS[chain];
  const orderChainId = Number(order.chainId);
  const orderHash = safeHash(order.orderHash);
  const encodedOrder = safeHex(order.encodedOrder);
  const signature = safeHex(order.signature);
  const reactor = safeAddress(order.reactor);
  if (!chainId || orderChainId !== chainId || !orderHash || !encodedOrder || !signature || !reactor) return false;
  if (String(order.orderStatus || '').toLowerCase() !== 'open') return false;
  const allowedReactors = new Set(currentReactors(chain).map(value => value.toLowerCase()));
  if (!allowedReactors.has(reactor.toLowerCase())) return false;

  const resolved = await resolvedOrder(chain, encodedOrder, signature);
  const resolvedReactor = safeAddress(resolved?.info?.reactor);
  const inputToken = safeAddress(resolved?.input?.token);
  const inputAmount = BigInt(ethers.BigNumber.from(resolved?.input?.amount ?? 0).toString());
  const output = oneOutputAsset(Array.from(resolved?.outputs || []));
  if (!resolvedReactor || resolvedReactor.toLowerCase() !== reactor.toLowerCase()) return false;
  if (!inputToken || inputToken === ethers.constants.AddressZero || inputAmount <= 0n || !output) return false;
  if (inputToken.toLowerCase() === output.token.toLowerCase()) return false;

  const slip = slippagePpm();
  const quote = await getHedgedDexQuote({
    chainId,
    sellToken: inputToken,
    buyToken: output.token,
    sellAmount: inputAmount.toString(),
    takerAddress: filler,
    purpose: 'execution',
    forceRefresh: true,
    slippagePpm: slip,
  });
  if (!quote?.executable || !quote.transaction) return false;
  if (String(quote.transaction.value || '0') !== '0') return false;
  const routeTarget = safeAddress(quote.transaction.to);
  const routeData = safeHex(quote.transaction.data);
  const quotedBuy = BigInt(String(quote.buyAmount || '0'));
  if (!routeTarget || !routeData || quotedBuy <= 0n) return false;

  const conservativeBuy = (quotedBuy * BigInt(1_000_000 - slip)) / 1_000_000n;
  if (conservativeBuy <= output.required) return false;
  const minimumProfit = conservativeBuy - output.required;
  if (minimumProfit <= 0n) return false;

  const fillerInterface = new ethers.utils.Interface(FILLER_ABI);
  const data = fillerInterface.encodeFunctionData('executeSignedOrder', [
    reactor,
    encodedOrder,
    signature,
    {
      target: routeTarget,
      data: routeData,
      inputToken,
      profitToken: output.token,
      inputAmount: inputAmount.toString(),
      minProfit: minimumProfit.toString(),
    },
  ]);

  const work = await enqueueGhostWalletWork({
    dedupeKey: `ghost-uniswapx-fill:${chain}:${orderHash}`,
    kind: 'prepared_atomic_execution',
    chain,
    priority: 930,
    maxAttempts: 8,
    payload: {
      mode: 'broker_execution',
      chain,
      to: filler,
      data,
      value: '0',
      asset: output.token,
      expectedSpreadBaseUnits: minimumProfit.toString(),
      sourceKind: 'uniswapx_signed_order_zero_inventory',
      lender: reactor,
      amountBaseUnits: inputAmount.toString(),
      orderHash,
      uniswapXOrderType: String(order.type || 'unknown'),
      demandAuthority: 'uniswapx_public_signed_order_feed',
      operatorTradingPrincipalRequired: false,
    },
  });
  if (work.status === 'QUEUED' || work.status === 'RETRYABLE') {
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
    return true;
  }
  return work.status === 'SUBMITTED' || work.status === 'SETTLED';
}

class GhostWalletUniswapXDemand {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private nextChainIndex = 0;
  private inFlight = false;
  private readonly nextOrderCheck = new Map<string, number>();
  private readonly fillerAddresses: Partial<Record<GhostWalletChain, string>> = {};
  private polls = 0;
  private fetchedOrders = 0;
  private executableOrders = 0;
  private queuedOrders = 0;
  private rejectedOrders = 0;
  private routeLocalErrors = 0;
  private lastPollAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;

  async start(): Promise<void> {
    if (this.running || !enabled()) return;
    this.running = true;
    await ghostWalletProviderMesh.initialize().catch(() => undefined);
    queueMicrotask(() => { void this.tick(); });
    logger.info('[GhostWalletUniswapX] Public signed atomic-demand lane started', {
      component: 'GhostWalletUniswapXDemand',
      apiKeyRequired: false,
      signupRequired: false,
      genericOrdersReclassifiedAsBorrowerMandates: false,
      zeroInventoryFillContract: true,
      controllerGasAuthority: 'pimlico_sponsored_user_operation',
      strictlyPositiveAllInEconomicsRequiredByUltraWorker: true,
      supportedExecutableChains: getGhostWalletPimlicoSupportedChains().filter(chain => Boolean(CHAIN_IDS[chain] && UNISWAPX_REACTORS[chain]?.length)),
      avalancheObservationOnlyUntilPimlico7702Supported: true,
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus(): DemandStatus {
    return {
      running: this.running,
      nextChainIndex: this.nextChainIndex,
      polls: this.polls,
      fetchedOrders: this.fetchedOrders,
      executableOrders: this.executableOrders,
      queuedOrders: this.queuedOrders,
      rejectedOrders: this.rejectedOrders,
      routeLocalErrors: this.routeLocalErrors,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      fillerAddresses: { ...this.fillerAddresses },
    };
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, pollMs());
    this.timer.unref?.();
  }

  private pruneOrderChecks(now: number): void {
    if (this.nextOrderCheck.size < 2_000) return;
    for (const [key, at] of this.nextOrderCheck) if (now - at > ORDER_TTL_MS) this.nextOrderCheck.delete(key);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    this.lastPollAt = Date.now();
    try {
      const executable = getGhostWalletPimlicoSupportedChains()
        .filter(chain => Boolean(CHAIN_IDS[chain] && UNISWAPX_REACTORS[chain]?.length));
      if (executable.length === 0) return;
      const chain = executable[this.nextChainIndex % executable.length];
      this.nextChainIndex = (this.nextChainIndex + 1) % executable.length;
      const chainId = CHAIN_IDS[chain]!;
      this.polls += 1;

      const filler = await ensureFiller(chain);
      if (!filler) return;
      this.fillerAddresses[chain] = filler;

      const orders = await fetchOpenOrders(chainId);
      this.fetchedOrders += orders.length;
      const now = Date.now();
      this.pruneOrderChecks(now);
      const candidates = orders.filter(order => {
        const hash = safeHash(order.orderHash);
        if (!hash) return false;
        const next = this.nextOrderCheck.get(`${chain}:${hash}`) || 0;
        return next <= now;
      }).slice(0, MAX_ORDERS_PER_TICK);

      const results = await Promise.allSettled(candidates.map(async order => {
        const hash = safeHash(order.orderHash);
        if (hash) this.nextOrderCheck.set(`${chain}:${hash}`, Date.now() + ORDER_RECHECK_MS);
        const queued = await qualifyAndQueue(chain, filler, order);
        if (queued) {
          this.executableOrders += 1;
          this.queuedOrders += 1;
        } else {
          this.rejectedOrders += 1;
        }
      }));
      const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
      if (failures.length > 0) {
        this.routeLocalErrors += failures.length;
        this.lastError = failures[0].reason instanceof Error ? failures[0].reason.message : String(failures[0].reason);
      } else {
        this.lastError = null;
      }
      this.lastSuccessAt = Date.now();
    } catch (error) {
      this.routeLocalErrors += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.debug('[GhostWalletUniswapX] Atomic-demand source degraded locally', {
        component: 'GhostWalletUniswapXDemand',
        error: this.lastError,
        routeLocalFailure: true,
      });
    } finally {
      this.inFlight = false;
      this.schedule();
    }
  }
}

export const ghostWalletUniswapXDemand = new GhostWalletUniswapXDemand();

export const GHOST_WALLET_UNISWAPX_DEMAND_POLICY = {
  publicSignedOrderFeed: 'https://api.uniswap.org/v2/orders',
  apiKeyRequired: false,
  signupRequired: false,
  genericSwapOrdersAreBorrowerMandates: false,
  zeroInventoryCallbackFiller: true,
  sameTransactionSettlement: true,
  outputShortfallReverts: true,
  canonicalPimlicoGasAuthorityPreserved: true,
  canonicalFinalEconomicsAuthorityPreserved: true,
  conservativeSlippageProfitAdmission: true,
  routeLocalSourceFailure: true,
  orderReconsiderationEnabled: true,
  feedRateBoundedRoundRobin: true,
} as const;
