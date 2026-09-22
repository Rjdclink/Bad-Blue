Warning: truncated output (original token count: 4796)
Total output lines: 446

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generatePantheonBackgroundReportPdf,
  verifyPantheonPdfBuffer,
} fr…4696 tokens truncated…
  console.log('Pantheon end-to-end coverage, provenance, evidence, and PDF layout verification passed.');
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
