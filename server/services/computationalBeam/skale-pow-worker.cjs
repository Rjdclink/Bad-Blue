const { parentPort, workerData } = require('node:worker_threads');
const { BigNumber, ethers } = require('ethers');

const MAX_U256 = (1n << 256n) - 1n;
const cancellation = new Int32Array(workerData.cancellationBuffer);

function u256Bytes(value) {
  return ethers.utils.arrayify(
    ethers.utils.hexZeroPad(ethers.utils.hexlify(BigNumber.from(value.toString())), 32),
  );
}

function hashAsU256(value) {
  return BigInt(ethers.utils.keccak256(value));
}

function externalGas(sender, nonce, candidate, difficulty) {
  let hash = hashAsU256(ethers.utils.arrayify(ethers.utils.getAddress(sender))) ^
    hashAsU256(u256Bytes(nonce)) ^
    hashAsU256(u256Bytes(candidate));
  if (hash === 0n) hash = 1n;
  return MAX_U256 / hash / difficulty;
}

function candidateForAttempt(workloadId, partitionId, partitionCount, attempt) {
  const seed = BigInt(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(workloadId)));
  return (seed + BigInt(partitionId) + BigInt(attempt) * BigInt(partitionCount)) & MAX_U256;
}

const { workloadId, sender, nonce, difficulty, requiredGas, partitionId, partitionCount, maxAttempts } = workerData;
const normalizedDifficulty = BigInt(difficulty);
const normalizedRequiredGas = BigInt(requiredGas);

for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
  if (Atomics.load(cancellation, 0) !== 0) {
    parentPort.postMessage({ type: 'cancelled', attempts: attempt });
    process.exit(0);
  }
  const candidate = candidateForAttempt(workloadId, partitionId, partitionCount, attempt);
  const minedGas = externalGas(sender, nonce, candidate, normalizedDifficulty);
  if (minedGas >= normalizedRequiredGas) {
    parentPort.postMessage({
      type: 'candidate',
      gasPriceWei: candidate.toString(),
      externalGas: minedGas.toString(),
      attempts: attempt + 1,
      partitionId,
    });
    process.exit(0);
  }
}

parentPort.postMessage({ type: 'exhausted', attempts: maxAttempts, partitionId });