import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileReceiverContract } from './compile-flashloan-receiver.js';

async function writeArtifact(input: {
  sourceName: string;
  contractName: string;
  outputPath: string;
  viaIR?: boolean;
}): Promise<string> {
  const artifact = await compileReceiverContract(
    input.sourceName,
    input.contractName,
    { viaIR: input.viaIR === true },
  );
  const destination = resolve(process.cwd(), input.outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return destination;
}

async function main(): Promise<void> {
  const [intermediary, vault] = await Promise.all([
    writeArtifact({
      sourceName: 'contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol',
      contractName: 'CryptocrawlGhostWalletIntermediary',
      outputPath: 'artifacts/cryptocrawl/CryptocrawlGhostWalletIntermediary.json',
      viaIR: true,
    }),
    writeArtifact({
      sourceName: 'contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol',
      contractName: 'CryptocrawlGhostWalletCapitalVault',
      outputPath: 'artifacts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.json',
      viaIR: true,
    }),
  ]);

  console.log(`[ghost-wallet-compile] intermediary artifact: ${intermediary}`);
  console.log(`[ghost-wallet-compile] capital vault artifact: ${vault}`);
}

main().catch(error => {
  console.error('[ghost-wallet-compile] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
