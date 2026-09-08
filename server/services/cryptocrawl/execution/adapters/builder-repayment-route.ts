import { BigNumber, Contract, ethers, providers } from 'ethers';

export type BuilderRepaymentRouteName = 'uniswap_v2' | 'sushiswap_v2';

export interface BuilderRepaymentRouteQuote {
  name: BuilderRepaymentRouteName;
  router: string;
  path: string[];
  quotedInput: bigint;
  maxInput: bigint;
  measuredAt: number;
  provenance: string[];
}

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

const ROUTES: ReadonlyArray<{ name: BuilderRepaymentRouteName; router: string }> = [
  { name: 'uniswap_v2', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
  { name: 'sushiswap_v2', router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F' },
];
const ROUTER_VIEW_ABI = ['function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)'];
const ROUTER_EXECUTION_INTERFACE = new ethers.utils.Interface([
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
]);

function boundedSlippageBps(raw: number): number {
  if (!Number.isFinite(raw)) return 50;
  return Math.max(1, Math.min(500, Math.trunc(raw)));
}

function ceilBps(value: bigint, bps: number): bigint {
  return (value * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function repaymentPaths(inputToken: string): string[][] {
  const direct = [inputToken, WETH];
  const intermediates = [USDC, USDT, DAI]
    .filter(token => !sameAddress(token, inputToken) && !sameAddress(token, WETH));
  const paths = [direct, ...intermediates.map(token => [inputToken, token, WETH])];
  const seen = new Set<string>();
  return paths.filter(path => {
    const key = path.map(token => token.toLowerCase()).join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function quoteRoute(input: {
  route: { name: BuilderRepaymentRouteName; router: string };
  provider: providers.Provider;
  inputToken: string;
  path: string[];
  amountOutWei: bigint;
  slippageBps: number;
}): Promise<BuilderRepaymentRouteQuote | null> {
  try {
    const code = await input.provider.getCode(input.route.router);
    if (code === '0x') return null;
    const router = new Contract(input.route.router, ROUTER_VIEW_ABI, input.provider);
    const amounts = await router.getAmountsIn(BigNumber.from(input.amountOutWei.toString()), input.path) as BigNumber[];
    if (!Array.isArray(amounts) || amounts.length !== input.path.length || !amounts[0] || amounts[0].lte(0)) return null;
    const quotedInput = BigInt(amounts[0].toString());
    return {
      name: input.route.name,
      router: input.route.router,
      path: [...input.path],
      quotedInput,
      maxInput: ceilBps(quotedInput, input.slippageBps),
      measuredAt: Date.now(),
      provenance: [
        `builder_repayment_route:${input.route.name}`,
        `builder_repayment_path:${input.path.map(token => token.toLowerCase()).join('>')}`,
        `builder_repayment_hops:${input.path.length - 1}`,
        'builder_repayment_quote:getAmountsIn',
        'builder_repayment_output:exact_eth',
        'builder_repayment_route_failure_isolated:true',
        'synthetic_evidence:false',
      ],
    };
  } catch {
    return null;
  }
}

export async function selectBuilderRepaymentRoute(input: {
  provider: providers.Provider;
  inputToken: string;
  amountOutWei: bigint;
  slippageBps: number;
}): Promise<BuilderRepaymentRouteQuote | null> {
  if (!ethers.utils.isAddress(input.inputToken) || input.amountOutWei <= 0n) return null;
  const slippageBps = boundedSlippageBps(input.slippageBps);
  const paths = repaymentPaths(ethers.utils.getAddress(input.inputToken));
  const attempts = ROUTES.flatMap(route => paths.map(path => quoteRoute({
    ...input,
    inputToken: ethers.utils.getAddress(input.inputToken),
    route,
    path,
    slippageBps,
  })));
  const measured = (await Promise.all(attempts))
    .filter((quote): quote is BuilderRepaymentRouteQuote => quote !== null)
    .sort((left, right) => left.quotedInput < right.quotedInput ? -1 : left.quotedInput > right.quotedInput ? 1 : left.path.length - right.path.length || left.name.localeCompare(right.name));
  if (measured.length === 0) return null;
  const selected = measured[0];
  return {
    ...selected,
    path: [...selected.path],
    provenance: [
      ...selected.provenance,
      `builder_repayment_routes_measured:${measured.map(route => `${route.name}:${route.path.length - 1}hop`).join(',')}`,
      'builder_repayment_selection:lowest_measured_exact_input',
      'builder_repayment_direct_weth_not_mandatory:true',
    ],
  };
}

export function buildBuilderRepaymentSwapData(input: {
  route: BuilderRepaymentRouteQuote;
  amountOutWei: bigint;
  recipient: string;
  deadline: number;
}): string {
  if (!ethers.utils.isAddress(input.recipient)) throw new Error('Builder repayment recipient must be a valid address');
  return ROUTER_EXECUTION_INTERFACE.encodeFunctionData('swapTokensForExactETH', [
    BigNumber.from(input.amountOutWei.toString()),
    BigNumber.from(input.route.maxInput.toString()),
    input.route.path,
    input.recipient,
    input.deadline,
  ]);
}
