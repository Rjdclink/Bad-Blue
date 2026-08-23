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

function runProcess(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
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

  return {
    command: 'npx',
    args: ['--yes', 'solc@0.8.24', '--standard-json'],
    label: 'npx --yes solc@0.8.24 --standard-json',
  };
}

export async function compileReceiverContract(sourceName: string, contractName: string, options?: { viaIR?: boolean }): Promise<ReceiverArtifact> {
  const sourcePath = resolve(process.cwd(), sourceName);
  const source = await readFile(sourcePath, 'utf8');
  const compiler = resolveCompiler();
  const input = {
    language: 'Solidity',
    sources: {
      [sourceName]: { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      ...(options?.viaIR ? { viaIR: true } : {}),
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const stdout = await runProcess(compiler.command, compiler.args, JSON.stringify(input));
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`Solidity compiler returned no standard JSON output: ${stdout.trim()}`);
  }
  const output = JSON.parse(stdout.slice(jsonStart)) as {
    errors?: Array<{ severity?: string; formattedMessage?: string; message?: string }>;
    contracts?: Record<string, Record<string, { abi: unknown[]; evm?: { bytecode?: { object?: string } } }>>;
  };
  const errors = output.errors?.filter(error => error.severity === 'error') || [];
  if (errors.length > 0) {
    throw new Error(errors.map(error => error.formattedMessage || error.message || 'Unknown Solidity compile error').join('\n'));
  }

  const compiled = output.contracts?.[sourceName]?.[contractName];
  const bytecode = compiled?.evm?.bytecode?.object;
  if (!compiled || !bytecode) {
    throw new Error(`Compiler did not produce ${contractName} bytecode`);
  }

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

export async function compileSushiV3FlashReceiver(): Promise<ReceiverArtifact> {
  return compileReceiverContract(
    'contracts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.sol',
    'CryptocrawlSushiV3FlashReceiver',
    { viaIR: true },
  );
}

export async function writeFlashLoanReceiverArtifact(outputPath?: string): Promise<string> {
  const artifact = await compileFlashLoanReceiver();
  const destination = resolve(
    process.cwd(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json',
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return destination;
}

export async function writeSushiV3FlashReceiverArtifact(outputPath?: string): Promise<string> {
  const artifact = await compileSushiV3FlashReceiver();
  const destination = resolve(
    process.cwd(),
    outputPath || 'artifacts/cryptocrawl/CryptocrawlSushiV3FlashReceiver.json',
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return destination;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFlashLoanReceiverArtifact()
    .then(outputPath => {
      console.log(`Compiled ${CONTRACT_NAME} artifact: ${outputPath}`);
    })
    .catch(error => {
      console.error('[compile-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}