import { Contract, ethers, providers } from 'ethers';
import { EUROPA_NETWORK } from './europa-network.js';

export const EUROPA_SUSHI = {
  routeProcessor: '0xac4c6e212a361c968f1725b4d055b47e63f80b75',
  v3Factory: '0x51d15889b66a2c919dbbd624d53b47a9e8fec4bb',
  tokens: {
    usdc: '0x5f795bb52dac3085f578f4877d450e2929d2f13d',
    skl: '0xe0595a049d02b7674572b0d59cd4880db60edc50',
    eth: '0xd2aaa00700000000000000000000000000000000',
  },
  pools: {
    usdcSkl: '0x0e9878153c1500ec48b51cdd5325c7e374c9cdae',
    sklEth: '0x1b35e16fa9a453a404a239310892a319c70cda09',
    ethUsdc: '0x5e359b616eab96977473ba7b7de7107abe5b345b',
  },
} as const;

const POOL_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
];

export interface EuropaSushiPoolEvidence {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  codeHash: string;
}

export interface EuropaSushiRegistryEvidence {
  chainId: number;
  routeProcessorCodeHash: string;
  factoryCodeHash: string;
  pools: EuropaSushiPoolEvidence[];
}

function addressEquals(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function codeHash(provider: providers.Provider, address: string): Promise<string> {
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error(`Expected deployed code at ${address}`);
  return ethers.utils.keccak256(code);
}

export async function verifyEuropaSushiRegistry(provider: providers.Provider): Promise<EuropaSushiRegistryEvidence> {
  const network = await provider.getNetwork();
  if (network.chainId !== EUROPA_NETWORK.chainId) {
    throw new Error(`Expected Europa chain ID ${EUROPA_NETWORK.chainId}, received ${network.chainId}`);
  }

  const expectedPools = [
    { address: EUROPA_SUSHI.pools.usdcSkl, token0: EUROPA_SUSHI.tokens.usdc, token1: EUROPA_SUSHI.tokens.skl },
    { address: EUROPA_SUSHI.pools.sklEth, token0: EUROPA_SUSHI.tokens.eth, token1: EUROPA_SUSHI.tokens.skl },
    { address: EUROPA_SUSHI.pools.ethUsdc, token0: EUROPA_SUSHI.tokens.usdc, token1: EUROPA_SUSHI.tokens.eth },
  ];

  const pools = await Promise.all(expectedPools.map(async expected => {
    const pool = new Contract(expected.address, POOL_ABI, provider);
    const [factory, token0, token1, fee, liquidity, poolCodeHash] = await Promise.all([
      pool.factory(),
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.liquidity(),
      codeHash(provider, expected.address),
    ]);
    if (!addressEquals(factory, EUROPA_SUSHI.v3Factory)) throw new Error(`Unexpected Sushi V3 factory for ${expected.address}: ${factory}`);
    if (!addressEquals(token0, expected.token0) || !addressEquals(token1, expected.token1)) {
      throw new Error(`Unexpected token ordering for ${expected.address}`);
    }
    if (Number(fee) !== 3000) throw new Error(`Unexpected fee tier for ${expected.address}: ${fee}`);
    if (BigInt(liquidity.toString()) === 0n) throw new Error(`Pool ${expected.address} has no active liquidity`);
    return { address: expected.address, token0, token1, fee: Number(fee), liquidity: liquidity.toString(), codeHash: poolCodeHash };
  }));

  return {
    chainId: network.chainId,
    routeProcessorCodeHash: await codeHash(provider, EUROPA_SUSHI.routeProcessor),
    factoryCodeHash: await codeHash(provider, EUROPA_SUSHI.v3Factory),
    pools,
  };
}