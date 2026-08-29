import { ethers } from 'ethers';

export interface DecodedPendingSwapRoute {
  method: string;
  tokenPath: string[];
  feeTiers: number[];
  amountIn: string | null;
  amountInMaximum: string | null;
  amountOut: string | null;
  amountOutMinimum: string | null;
  recipient: string | null;
  deadline: string | null;
  routeComplete: boolean;
  provenance: string[];
}

const V2 = new ethers.utils.Interface([
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapETHForExactTokens(uint256 amountOut,address[] path,address to,uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)',
]);

const V3 = new ethers.utils.Interface([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)',
  'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum) params) returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn)',
  'function exactOutput((bytes path,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum) params) returns (uint256 amountIn)',
]);

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return String(value);
  } catch {
    return null;
  }
}

function addresses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => String(value || '').toLowerCase())
    .filter(value => /^0x[a-f0-9]{40}$/.test(value));
}

function decodePackedV3Path(raw: unknown): { tokenPath: string[]; feeTiers: number[] } {
  if (typeof raw !== 'string' || !/^0x[a-fA-F0-9]+$/.test(raw)) return { tokenPath: [], feeTiers: [] };
  const hex = raw.slice(2);
  if (hex.length < 40) return { tokenPath: [], feeTiers: [] };
  const tokenPath: string[] = [`0x${hex.slice(0, 40).toLowerCase()}`];
  const feeTiers: number[] = [];
  let offset = 40;
  while (offset + 46 <= hex.length) {
    const fee = Number.parseInt(hex.slice(offset, offset + 6), 16);
    const token = `0x${hex.slice(offset + 6, offset + 46).toLowerCase()}`;
    if (!Number.isFinite(fee) || !/^0x[a-f0-9]{40}$/.test(token)) return { tokenPath: [], feeTiers: [] };
    feeTiers.push(fee);
    tokenPath.push(token);
    offset += 46;
  }
  return offset === hex.length ? { tokenPath, feeTiers } : { tokenPath: [], feeTiers: [] };
}

function result(input: Omit<DecodedPendingSwapRoute, 'routeComplete' | 'provenance'>): DecodedPendingSwapRoute {
  const routeComplete = input.tokenPath.length >= 2;
  return {
    ...input,
    routeComplete,
    provenance: [
      `decoded_pending_swap:${input.method}`,
      `decoded_token_hops:${Math.max(0, input.tokenPath.length - 1)}`,
      'calldata_decode_only',
      'post_transaction_state:not_simulated',
      'execution_authority:false',
      'synthetic_evidence:false',
    ],
  };
}

function decodeV2(input: string): DecodedPendingSwapRoute | null {
  try {
    const parsed = V2.parseTransaction({ data: input });
    if (!parsed) return null;
    const args = parsed.args as any;
    const path = addresses(args.path);
    switch (parsed.name) {
      case 'swapExactTokensForTokens':
      case 'swapExactTokensForETH':
        return result({
          method: parsed.name,
          tokenPath: path,
          feeTiers: [],
          amountIn: asString(args.amountIn),
          amountInMaximum: null,
          amountOut: null,
          amountOutMinimum: asString(args.amountOutMin),
          recipient: asString(args.to)?.toLowerCase() || null,
          deadline: asString(args.deadline),
        });
      case 'swapTokensForExactTokens':
      case 'swapTokensForExactETH':
        return result({
          method: parsed.name,
          tokenPath: path,
          feeTiers: [],
          amountIn: null,
          amountInMaximum: asString(args.amountInMax),
          amountOut: asString(args.amountOut),
          amountOutMinimum: null,
          recipient: asString(args.to)?.toLowerCase() || null,
          deadline: asString(args.deadline),
        });
      case 'swapExactETHForTokens':
        return result({
          method: parsed.name,
          tokenPath: path,
          feeTiers: [],
          amountIn: null,
          amountInMaximum: null,
          amountOut: null,
          amountOutMinimum: asString(args.amountOutMin),
          recipient: asString(args.to)?.toLowerCase() || null,
          deadline: asString(args.deadline),
        });
      case 'swapETHForExactTokens':
        return result({
          method: parsed.name,
          tokenPath: path,
          feeTiers: [],
          amountIn: null,
          amountInMaximum: null,
          amountOut: asString(args.amountOut),
          amountOutMinimum: null,
          recipient: asString(args.to)?.toLowerCase() || null,
          deadline: asString(args.deadline),
        });
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function decodeV3(input: string): DecodedPendingSwapRoute | null {
  try {
    const parsed = V3.parseTransaction({ data: input });
    if (!parsed) return null;
    const params = parsed.args?.params || parsed.args?.[0];
    if (!params) return null;
    if (parsed.name === 'exactInputSingle') {
      return result({
        method: parsed.name,
        tokenPath: addresses([params.tokenIn, params.tokenOut]),
        feeTiers: Number.isFinite(Number(params.fee)) ? [Number(params.fee)] : [],
        amountIn: asString(params.amountIn),
        amountInMaximum: null,
        amountOut: null,
        amountOutMinimum: asString(params.amountOutMinimum),
        recipient: asString(params.recipient)?.toLowerCase() || null,
        deadline: asString(params.deadline),
      });
    }
    if (parsed.name === 'exactOutputSingle') {
      return result({
        method: parsed.name,
        tokenPath: addresses([params.tokenIn, params.tokenOut]),
        feeTiers: Number.isFinite(Number(params.fee)) ? [Number(params.fee)] : [],
        amountIn: null,
        amountInMaximum: asString(params.amountInMaximum),
        amountOut: asString(params.amountOut),
        amountOutMinimum: null,
        recipient: asString(params.recipient)?.toLowerCase() || null,
        deadline: asString(params.deadline),
      });
    }
    const packed = decodePackedV3Path(params.path);
    if (parsed.name === 'exactInput') {
      return result({
        method: parsed.name,
        tokenPath: packed.tokenPath,
        feeTiers: packed.feeTiers,
        amountIn: asString(params.amountIn),
        amountInMaximum: null,
        amountOut: null,
        amountOutMinimum: asString(params.amountOutMinimum),
        recipient: asString(params.recipient)?.toLowerCase() || null,
        deadline: asString(params.deadline),
      });
    }
    if (parsed.name === 'exactOutput') {
      // Uniswap V3 exact-output packed paths are encoded in reverse execution order.
      return result({
        method: parsed.name,
        tokenPath: [...packed.tokenPath].reverse(),
        feeTiers: [...packed.feeTiers].reverse(),
        amountIn: null,
        amountInMaximum: asString(params.amountInMaximum),
        amountOut: asString(params.amountOut),
        amountOutMinimum: null,
        recipient: asString(params.recipient)?.toLowerCase() || null,
        deadline: asString(params.deadline),
      });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Conservative calldata-only route decoder. It never estimates profit, pool state,
 * inclusion probability or execution authority; unsupported calldata stays null.
 */
export function decodePendingSwapRoute(input: string): DecodedPendingSwapRoute | null {
  if (!input || input.length < 10) return null;
  return decodeV2(input) || decodeV3(input);
}
