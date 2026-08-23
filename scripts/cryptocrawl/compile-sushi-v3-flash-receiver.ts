import { writeSushiV3FlashReceiverArtifact } from './compile-flashloan-receiver.js';

writeSushiV3FlashReceiverArtifact()
  .then(outputPath => console.log(`Compiled CryptocrawlSushiV3FlashReceiver artifact: ${outputPath}`))
  .catch(error => {
    console.error('[compile-sushi-v3-flash-receiver] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });