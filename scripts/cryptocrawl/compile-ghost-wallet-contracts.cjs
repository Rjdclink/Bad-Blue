'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const contracts = [
  {
    sourceName: 'contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol',
    contractName: 'CryptocrawlGhostWalletIntermediary',
    outputPath: 'artifacts/cryptocrawl/CryptocrawlGhostWalletIntermediary.json',
  },
  {
    sourceName: 'contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol',
    contractName: 'CryptocrawlGhostWalletCapitalVault',
    outputPath: 'artifacts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.json',
  },
  {
    sourceName: 'contracts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.sol',
    contractName: 'CryptocrawlGhostWalletErc3156Bridge',
    outputPath: 'artifacts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.json',
  },
];

function compiler() {
  const configured = String(process.env.ZERO_CAPITAL_SOLC_BIN || '').trim();
  if (configured) {
    const args = String(process.env.ZERO_CAPITAL_SOLC_ARGS || '--standard-json')
      .trim().split(/\s+/).filter(Boolean);
    return { command: configured, args, label: `${configured} ${args.join(' ')}`.trim() };
  }

  // Keep solc and its exact hashing dependency in the same npm-exec environment.
  // This avoids the incomplete isolated npx install that can otherwise break a
  // production build before contract artifacts are generated.
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

function compile(spec) {
  const sourcePath = path.resolve(process.cwd(), spec.sourceName);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const selected = compiler();
  const input = {
    language: 'Solidity',
    sources: { [spec.sourceName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const result = spawnSync(selected.command, selected.args, {
    cwd: process.cwd(),
    env: process.env,
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Solidity compiler failed for ${spec.contractName}: ${result.stderr || result.stdout}`);
  }
  const stdout = String(result.stdout || '');
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`Solidity compiler produced no JSON for ${spec.contractName}`);
  const output = JSON.parse(stdout.slice(start));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) {
    throw new Error(errors.map(error => error.formattedMessage || error.message || 'Solidity compile error').join('\n'));
  }
  const compiled = output.contracts?.[spec.sourceName]?.[spec.contractName];
  const bytecode = compiled?.evm?.bytecode?.object;
  if (!compiled || !bytecode) throw new Error(`Compiler produced no bytecode for ${spec.contractName}`);
  const destination = path.resolve(process.cwd(), spec.outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify({
    contractName: spec.contractName,
    sourceName: spec.sourceName,
    abi: compiled.abi,
    bytecode: `0x${bytecode}`,
    compiler: selected.label,
  }, null, 2)}\n`, 'utf8');
  console.log(`[ghost-wallet-compile] ${spec.contractName}: ${destination}`);
}

for (const spec of contracts) compile(spec);
console.log(`[ghost-wallet-compile] ${contracts.length} Ghost Wallet contracts compiled successfully`);
