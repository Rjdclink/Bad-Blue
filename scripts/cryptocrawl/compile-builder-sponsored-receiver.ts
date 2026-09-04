import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileReceiverContract } from './compile-flashloan-receiver.js';

const SOURCE = 'contracts/cryptocrawl/CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver.sol';
const CONTRACT = 'CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver';
const DEFAULT_OUTPUT = 'artifacts/cryptocrawl/CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver.json';

export async function compileBuilderSponsoredReceiver(outputPath = DEFAULT_OUTPUT): Promise<string> {
  const artifact = await compileReceiverContract(SOURCE, CONTRACT, { viaIR: true });
  const destination = resolve(process.cwd(), outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return destination;
}

const isDirectInvocation = /(?:^|\/)compile-builder-sponsored-receiver\.(?:ts|js)$/.test(process.argv[1] || '');
if (isDirectInvocation) {
  compileBuilderSponsoredReceiver()
    .then(path => console.log(`Compiled ${CONTRACT} artifact: ${path}`))
    .catch(error => {
      console.error('[compile-builder-sponsored-receiver] failed:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
