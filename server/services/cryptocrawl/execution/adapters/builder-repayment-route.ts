import { BigNumber, Contract, ethers, providers } from 'ethers';

export type BuilderRepaymentRouteName = 'uniswap_v2' | 'sushiswap_v2';

export interface BuilderRepaymentRouteQuote {
  name: BuilderRepaymentRouteName;
  router: string;
  path: [string, string];
  quotedInput: bigint;
  maxInput: bigint;
  measuredAt: number;
  provenance: string[];
}

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
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

async function quoteRoute(input: {
  route: { name: BuilderRepaymentRouteName; router: string };
  provider: providers.Provider;
  inputToken: string;
  amountOutWei: bigint;
  slippageBps: number;
}): Promise<BuilderRepaymentRouteQuote | null> {
  try {
    const code = await input.provider.getCode(input.route.router);
    if (code === '0x') return null;
    const path: [string, string] = [input.inputToken, WETH];
    const router = new Contract(input.route.router, ROUTER_VIEW_ABI, input.provider);
    const amounts = await router.getAmountsIn(BigNumber.from(input.amountOutWei.toString()), path) as BigNumber[];
    if (!Array.isArray(amounts) || amounts.length !== 2 || !amounts[0] || amounts[0].lte(0)) return null;
    const quotedInput = BigInt(amounts[0].toString());
    return {
      name: input.route.name,
      router: input.route.router,
      path,
      quotedInput,
      maxInput: ceilBps(quotedInput, input.slippageBps),
      measuredAt: Date.now(),
      provenance: [
        `builder_repayment_route:${input.route.name}`,
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
  const measured = (await Promise.all(ROUTES.map(route => quoteRoute({ ...input, route, slippageBps }))))
    .filter((quote): quote is BuilderRepaymentRouteQuote => quote !== null)
    .sort((left, right) => left.quotedInput < right.quotedInput ? -1 : left.quotedInput > right.quotedInput ? 1 : left.name.localeCompare(right.name));
  if (measured.length === 0) return null;
  const selected = measured[0];
  return {
    ...selected,
    path: [...selected.path] as [string, string],
    provenance: [
      ...selected.provenance,
      `builder_repayment_routes_measured:${measured.map(route => route.name).join(',')}`,
      'builder_repayment_selection:lowest_measured_exact_input',
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
