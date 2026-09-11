import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ReceiverArtifact {
  contractName: string;
  sourceName: string;
  abi: unknown[];
  bytecode: string;
  compiler: string;
}

const SOURCE_NAME = 'contracts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.sol';
const CONTRACT_NAME = 'CryptocrawlBalancerFlashLoanReceiver';
const COMPOSITE_SOURCE_NAME = 'contracts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.sol';
const COMPOSITE_CONTRACT_NAME = 'CryptocrawlBalancerCompositeFlashLoanReceiver';
const AAVE_SOURCE_NAME = 'contracts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.sol';
const AAVE_CONTRACT_NAME = 'CryptocrawlAaveV3FlashLoanReceiver';
const MORPHO_SOURCE_NAME = 'contracts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.sol';
const MORPHO_CONTRACT_NAME = 'CryptocrawlMorphoFlashLoanReceiver';
const DUAL_SOURCE_NAME = 'contracts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.sol';
const DUAL_CONTRACT_NAME = 'CryptocrawlAaveBalancerDualFlashLoanReceiver';

function runProcess(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => reject(error));
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Solidity compiler exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolvePromise(stdout);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

function resolveCompiler(): { command: string; args: string[]; label: string } {
  const configuredBinary = process.env.ZERO_CAPITAL_SOLC_BIN?.trim();
  if (configuredBinary) {
    const configuredArgs = (process.env.ZERO_CAPITAL_SOLC_ARGS || '--standard-json')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return {
      command: configuredBinary,
      args: configuredArgs,
      label: `${configuredBinary} ${configuredArgs.join(' ')}`.trim(),
    };
  }

  // Keep the compiler and the exact hashing dependency it requires in one npm-exec
  // environment. This avoids an incomplete isolated npx install from making a
  // supported receiver disappear from the production build.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return {
    command: npm,
    args: [
      'exec',
      '--yes',
      '--package=solc@0.8.24',
      '--package=js-sha3@0.8.0',
      '--',
      'solcjs',
      '--standard-json',
    ],
    label: 'npm exec --package=solc@0.8.24 --package=js-sha3@0.8.0 -- solcjs --standard-json',
  };
}

export async function compileReceiverContract(sourceName: string, contractName: string, options?: { viaIR?: boolean }): Promise<ReceiverArtifact> {
  const sourcePath = resolve(process.cwd(), sourceName);
  const source = await readFile(sourcePath, 'utf8');
  const compiler = resolveCompiler();
  const input = {
    language: 'Solidity',
    sources: { [sourceName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      ...(options?.viaIR ? { viaIR: true } : {}),
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const stdout = await runProcess(compiler.command, compiler.args, JSON.stringify(input));
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) throw new Error(`Solidity compiler returned no standard JSON output: ${stdout.trim()}`);
  const output = JSON.parse(stdout.slice(jsonStart)) as {
    errors?: Array<{ severity?: string; formattedMessage?: string; message?: string }>;
    contracts?: Record<string, Record<string, { abi: unknown[]; evm?: { bytecode?: { object?: string } } }>>;
  };
  const errors = output.errors?.filter(error => error.severity === 'error') || [];
  if (errors.length > 0) throw new Error(errors.map(error => error.formattedMessage || error.message || 'Unknown Solidity compile error').join('\n'));

  const compiled = output.contracts?.[sourceName]?.[contractName];
  const bytecode = compiled?.evm?.bytecode?.object;
  if (!compiled || !bytecode) throw new Error(`Compiler did not produce ${contractName} bytecode`);

  return {
    contractName,
    sourceName,
    abi: compiled.abi,
    bytecode: `0x${bytecode}`,
    compiler: compiler.label,
  };
}

export async function compileFlashLoanReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(SOURCE_NAME, CONTRACT_NAME);
}

export async function compileCompositeFlashLoanReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(COMPOSITE_SOURCE_NAME, COMPOSITE_CONTRACT_NAME);
}

export async function compileAaveV3FlashLoanReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(AAVE_SOURCE_NAME, AAVE_CONTRACT_NAME);
}

export async function compileMorphoBlueFlashLoanReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(MORPHO_SOURCE_NAME, MORPHO_CONTRACT_NAME);
}

export async function compileAaveBalancerDualFlashLoanReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(DUAL_SOURCE_NAME, DUAL_CONTRACT_NAME, { viaIR: true });
}

export async function compileSushiV3FlashReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(
    'contracts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.sol',
    'CryptocrawlSushiV3FlashReceiver',
    { viaIR: true },
  );
}

async function writeArtifact(artifact: ReceiverArtifact, outputPath: string): Promise<string> {
  const destination = resolve(process.cwd(), outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return destination;
}

export async function writeFlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileFlashLoanReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json',
  );
}

export async function writeCompositeFlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileCompositeFlashLoanReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.json',
  );
}

export async function writeAaveV3FlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileAaveV3FlashLoanReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.json',
  );
}

export async function writeMorphoBlueFlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileMorphoBlueFlashLoanReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.json',
  );
}

export async function writeAaveBalancerDualFlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileAaveBalancerDualFlashLoanReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.json',
  );
}

export async function writeSushiV3FlashReceiverArtifact(outputPath?: string): Promise<string> {
  return writeArtifact(
    await compileSushiV3FlashReceiver(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.json',
  );
}

const isDirectInvocation = /(?:^|\/)compile-flashloan-receiver\.(?:ts|js)$/.test(process.argv[1] || '');
if (isDirectInvocation) {
  (async () => {
    // npm exec uses a shared temporary cache for identical package sets. Compile
    // these artifacts serially so the compiler installs once instead of racing
    // five concurrent installs against the same cache directory.
    const balancerPath = await writeFlashLoanReceiverArtifact();
    const compositePath = await writeCompositeFlashLoanReceiverArtifact();
    const aavePath = await writeAaveV3FlashLoanReceiverArtifact();
    const morphoPath = await writeMorphoBlueFlashLoanReceiverArtifact();
    const dualPath = await writeAaveBalancerDualFlashLoanReceiverArtifact();

    console.log(`Compiled ${CONTRACT_NAME} artifact: ${balancerPath}`);
    console.log(`Compiled ${COMPOSITE_CONTRACT_NAME} artifact: ${compositePath}`);
    console.log(`Compiled ${AAVE_CONTRACT_NAME} artifact: ${aavePath}`);
    console.log(`Compiled ${MORPHO_CONTRACT_NAME} artifact: ${morphoPath}`);
    console.log(`Compiled ${DUAL_CONTRACT_NAME} artifact: ${dualPath}`);
  })().catch(error => {
    console.error('[compile-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
